create or replace function public.vendai_solicitar_recuperacao_pin(p_telefone text, p_nome text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tel text := regexp_replace(coalesce(p_telefone,''), '[^0-9]', '', 'g');
  v_nome text := trim(coalesce(p_nome,''));
  v_user public.vendai_usuarios%rowtype;
  v_uid uuid := null;
begin
  if length(v_tel) not in (10,11) then raise exception 'telefone_invalido'; end if;
  if char_length(v_nome) < 2 then raise exception 'nome_invalido'; end if;

  select u.* into v_user
  from public.vendai_usuarios u
  where u.telefone = v_tel
  limit 1;

  if v_user.id is not null and lower(trim(v_user.nome)) = lower(v_nome) then
    v_uid := v_user.id;
  end if;

  insert into public.vendai_suporte(
    usuario_id, usuario_nome, usuario_telefone, tipo, mensagem, pagina, user_agent
  ) values (
    v_uid,
    v_nome,
    v_tel,
    'outro',
    case when v_uid is not null
      then 'RECUPERACAO_PIN | cadastro conferido pelo nome informado'
      else 'RECUPERACAO_PIN | conferir identidade antes de redefinir'
    end,
    'recuperacao-pin',
    'Vendaí Web/PWA'
  );

  return true;
end;
$$;

revoke all on function public.vendai_solicitar_recuperacao_pin(text,text) from public;
grant execute on function public.vendai_solicitar_recuperacao_pin(text,text) to anon, authenticated;

create or replace function public.vendai_trocar_pin(p_token uuid, p_pin_atual text, p_novo_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_hash text;
begin
  v_uid := vendai_private.usuario_da_sessao(p_token);
  if v_uid is null then raise exception 'sessao_invalida'; end if;
  if coalesce(p_pin_atual,'') !~ '^[0-9]{4,6}$' then raise exception 'pin_atual_invalido'; end if;
  if coalesce(p_novo_pin,'') !~ '^[0-9]{4,6}$' then raise exception 'novo_pin_invalido'; end if;

  select u.pin_hash into v_hash from public.vendai_usuarios u where u.id = v_uid;
  if v_hash is null or extensions.crypt(p_pin_atual, v_hash) <> v_hash then
    raise exception 'pin_atual_incorreto';
  end if;

  update public.vendai_usuarios
  set pin_hash = extensions.crypt(p_novo_pin, extensions.gen_salt('bf',10)), atualizado_em = now()
  where id = v_uid;

  delete from public.vendai_sessoes where usuario_id = v_uid and token <> p_token;
  return true;
end;
$$;

revoke all on function public.vendai_trocar_pin(uuid,text,text) from public;
grant execute on function public.vendai_trocar_pin(uuid,text,text) to anon, authenticated;

create or replace function public.vendai_admin_suporte(p_token uuid)
returns table(
  id uuid,
  usuario_id uuid,
  usuario_nome text,
  usuario_telefone text,
  tipo text,
  mensagem text,
  status text,
  criado_em timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not vendai_private.admin_valido(p_token) then raise exception 'sessao_admin_invalida'; end if;
  return query
  select s.id, s.usuario_id, s.usuario_nome, s.usuario_telefone, s.tipo, s.mensagem, s.status, s.criado_em
  from public.vendai_suporte s
  order by s.criado_em desc
  limit 300;
end;
$$;

revoke all on function public.vendai_admin_suporte(uuid) from public;
grant execute on function public.vendai_admin_suporte(uuid) to anon, authenticated;

create or replace function public.vendai_admin_redefinir_pin(p_token uuid, p_usuario_id uuid, p_novo_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not vendai_private.admin_valido(p_token) then raise exception 'sessao_admin_invalida'; end if;
  if coalesce(p_novo_pin,'') !~ '^[0-9]{4,6}$' then raise exception 'novo_pin_invalido'; end if;

  update public.vendai_usuarios
  set pin_hash = extensions.crypt(p_novo_pin, extensions.gen_salt('bf',10)), atualizado_em = now()
  where id = p_usuario_id;

  if not found then raise exception 'usuario_nao_encontrado'; end if;
  delete from public.vendai_sessoes where usuario_id = p_usuario_id;
  return true;
end;
$$;

revoke all on function public.vendai_admin_redefinir_pin(uuid,uuid,text) from public;
grant execute on function public.vendai_admin_redefinir_pin(uuid,uuid,text) to anon, authenticated;

create or replace function public.vendai_admin_status_suporte(p_token uuid, p_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not vendai_private.admin_valido(p_token) then raise exception 'sessao_admin_invalida'; end if;
  if p_status not in ('aberto','em_atendimento','resolvido') then raise exception 'status_invalido'; end if;
  update public.vendai_suporte set status = p_status where id = p_id;
  if not found then raise exception 'suporte_nao_encontrado'; end if;
  return true;
end;
$$;

revoke all on function public.vendai_admin_status_suporte(uuid,uuid,text) from public;
grant execute on function public.vendai_admin_status_suporte(uuid,uuid,text) to anon, authenticated;
