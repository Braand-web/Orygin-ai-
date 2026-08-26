/** Web application entry with an optional Supabase Auth gate for deployments. */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { AppWebEntry } from '@orygin-ai/dsh-client-web'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('web app: missing #root')
const el: HTMLElement = rootElement

interface AuthGlobal {
  __ORYGIN_AUTH__?: {
    getAccessToken: () => string | undefined
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const authRequired = import.meta.env.VITE_ORYGIN_AUTH_REQUIRED === '1'

let accessToken: string | undefined
let appStarted = false

function publishSession(session: Session | null): void {
  accessToken = session?.access_token
  ;(globalThis as AuthGlobal).__ORYGIN_AUTH__ = {
    getAccessToken: () => accessToken,
  }
}

async function startApp(): Promise<void> {
  if (appStarted) return
  appStarted = true
  el.replaceChildren()
  await new AppWebEntry(el).run()
}

function showConfigurationError(message: string): void {
  el.innerHTML = `<main style="max-width:32rem;margin:15vh auto;padding:2rem;font:16px system-ui;color:#171717">
    <h1 style="margin:0 0 1rem">Orygin</h1><p>${message}</p></main>`
}

function showAuthGate(supabase: SupabaseClient): void {
  el.innerHTML = `<main style="max-width:28rem;margin:12vh auto;padding:2rem;font:16px system-ui;color:#171717">
    <h1 style="margin:0 0 .5rem">Orygin</h1>
    <p style="margin:0 0 1.5rem;color:#525252">Connecte-toi pour accéder à ton espace.</p>
    <form id="orygin-auth-form" style="display:grid;gap:1rem">
      <label style="display:grid;gap:.35rem">Email
        <input name="email" type="email" autocomplete="email" required style="padding:.7rem;border:1px solid #cfcfcf;border-radius:.5rem;font:inherit" />
      </label>
      <label style="display:grid;gap:.35rem">Mot de passe
        <input name="password" type="password" minlength="6" autocomplete="current-password" required style="padding:.7rem;border:1px solid #cfcfcf;border-radius:.5rem;font:inherit" />
      </label>
      <button id="orygin-auth-submit" type="submit" style="padding:.7rem;border:0;border-radius:.5rem;background:#171717;color:white;font:inherit;cursor:pointer">Se connecter</button>
      <button id="orygin-auth-toggle" type="button" style="padding:.7rem;border:1px solid #cfcfcf;border-radius:.5rem;background:white;font:inherit;cursor:pointer">Créer un compte</button>
      <p id="orygin-auth-status" role="status" aria-live="polite" style="min-height:1.3rem;margin:0;color:#525252"></p>
    </form>
  </main>`

  const form = document.getElementById('orygin-auth-form') as HTMLFormElement | null
  const submit = document.getElementById('orygin-auth-submit') as HTMLButtonElement | null
  const toggle = document.getElementById('orygin-auth-toggle') as HTMLButtonElement | null
  const status = document.getElementById('orygin-auth-status')
  if (form === null || submit === null || toggle === null || status === null) return

  let signUp = false
  toggle.addEventListener('click', () => {
    signUp = !signUp
    submit.textContent = signUp ? 'Créer mon compte' : 'Se connecter'
    toggle.textContent = signUp ? 'J’ai déjà un compte' : 'Créer un compte'
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password !== null) password.autocomplete = signUp ? 'new-password' : 'current-password'
    status.textContent = ''
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      submit.disabled = true
      status.textContent = signUp ? 'Création du compte…' : 'Connexion…'
      const email = String((form.elements.namedItem('email') as HTMLInputElement).value).trim()
      const password = String((form.elements.namedItem('password') as HTMLInputElement).value)
      const result = signUp
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error !== null) {
        status.textContent = result.error.message
        submit.disabled = false
        return
      }
      publishSession(result.data.session)
      if (result.data.session === null) {
        status.textContent = 'Compte créé. Vérifie ton email pour confirmer ton inscription.'
        submit.disabled = false
        return
      }
      await startApp()
    })().catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      submit.disabled = false
    })
  })
}

async function bootstrap(): Promise<void> {
  if (!authRequired) {
    publishSession(null)
    await startApp()
    return
  }
  if (supabaseUrl === undefined || supabaseKey === undefined || supabaseUrl === '' || supabaseKey === '') {
    showConfigurationError('Authentification Supabase non configurée pour ce déploiement.')
    return
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  const { data, error } = await supabase.auth.getSession()
  if (error !== null) {
    showConfigurationError(`Impossible de charger la session : ${error.message}`)
    return
  }
  publishSession(data.session)
  if (data.session === null) showAuthGate(supabase)
  else await startApp()
  supabase.auth.onAuthStateChange((_event, session) => {
    publishSession(session)
    if (session !== null && !appStarted) queueMicrotask(() => { void startApp() })
    if (session === null && appStarted) window.location.reload()
  })
}

void bootstrap().catch((error: unknown) => {
  showConfigurationError(error instanceof Error ? error.message : String(error))
})
