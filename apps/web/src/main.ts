/** Web application entry with an optional Supabase Auth gate for deployments. */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { AppWebEntry } from '@orygin-ai/dsh-client-web'
import './auth.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('web app: missing #root')
const el: HTMLElement = rootElement

interface AuthGlobal {
  __ORYGIN_AUTH__?: {
    getAccessToken: () => string | undefined
    requestAuth?: () => void
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const authRequired = import.meta.env.VITE_ORYGIN_AUTH_REQUIRED === '1'

let accessToken: string | undefined
let appStarted = false
let authGateVisible = false
let guestDraft = ''

function publishSession(session: Session | null): void {
  accessToken = session?.access_token
  const requestAuth = (globalThis as AuthGlobal).__ORYGIN_AUTH__?.requestAuth
  ;(globalThis as AuthGlobal).__ORYGIN_AUTH__ = {
    getAccessToken: () => accessToken,
    ...requestAuth === undefined ? {} : { requestAuth },
  }
}

async function startApp(): Promise<void> {
  if (appStarted) return
  appStarted = true
  el.replaceChildren()
  await new AppWebEntry(el).run()
}

function showConfigurationError(message: string): void {
  el.innerHTML = `<main class="orygin-auth-state"><section class="orygin-auth-state-card" role="alert">
    <p class="orygin-auth-eyebrow">Espace Orygin</p><h1>Configuration indisponible</h1><p id="orygin-auth-config-message"></p></section></main>`
  const messageElement = document.getElementById('orygin-auth-config-message')
  if (messageElement !== null) messageElement.textContent = message
}

function showGuestShell(supabase: SupabaseClient): void {
  authGateVisible = false
  el.innerHTML = `<main class="orygin-guest-shell">
    <aside class="orygin-guest-sidebar">
      <div class="orygin-guest-brand"><img src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
      <button class="orygin-guest-new" type="button" data-auth-action>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
        <span>Nouveau chat</span>
      </button>
      <nav class="orygin-guest-nav" aria-label="Navigation principale">
        <button type="button" data-auth-action><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></svg><span>Recherche</span></button>
        <button type="button" data-auth-action><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 4.5 7.2v9.6L12 21l7.5-4.2V7.2L12 3Z" /><path d="M12 8v8M8.5 10l7 4M15.5 10l-7 4" /></svg><span>Orygin Diving</span></button>
      </nav>
      <div class="orygin-guest-sidebar-footer">
        <button type="button" data-auth-action><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h16M7 4v6M17 14v6M4 17h16" /></svg><span>Modèles</span></button>
        <button type="button" data-auth-action><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M8 3v4M16 3v4M6 7h12v5a6 6 0 0 1-12 0V7Z" /><path d="M12 18v3" /></svg><span>Plugins</span></button>
        <button class="orygin-guest-account" type="button" data-auth-action><span class="orygin-guest-avatar">O</span><span>Se connecter</span></button>
      </div>
    </aside>
    <section class="orygin-guest-main" aria-labelledby="orygin-guest-title">
      <header class="orygin-guest-topbar">
        <div class="orygin-guest-mobile-brand"><img src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
        <span class="orygin-guest-conversation">Nouvelle conversation</span>
        <button type="button" data-auth-action>Se connecter</button>
      </header>
      <div class="orygin-guest-stage">
        <div class="orygin-guest-intro">
          <img src="/favicon.svg" alt="" />
          <h1 id="orygin-guest-title">Que veux-tu accomplir ?</h1>
        </div>
        <form id="orygin-guest-composer" class="orygin-guest-composer">
          <textarea id="orygin-guest-input" rows="1" maxlength="12000" aria-label="Message" placeholder="Demander à Orygin…"></textarea>
          <div class="orygin-guest-composer-tools">
            <button type="button" data-auth-action aria-label="Ajouter une pièce jointe"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12.5 7.5-5.2 5.2a3 3 0 1 0 4.2 4.2l6.4-6.4a4.5 4.5 0 0 0-6.4-6.4L5.2 10.5" /></svg></button>
            <span>Orygin</span>
            <button class="orygin-guest-send" type="submit" aria-label="Envoyer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 19V5M6.5 10.5 12 5l5.5 5.5" /></svg></button>
          </div>
        </form>
        <p class="orygin-guest-hint">La connexion sera demandée au moment d’envoyer.</p>
      </div>
    </section>
  </main>`

  const input = document.getElementById('orygin-guest-input') as HTMLTextAreaElement | null
  const composer = document.getElementById('orygin-guest-composer') as HTMLFormElement | null
  if (input !== null) {
    input.value = guestDraft
    input.addEventListener('input', () => {
      guestDraft = input.value
    })
  }
  const openAuth = (): void => {
    showAuthGate(supabase, undefined, () => showGuestShell(supabase))
  }
  el.querySelectorAll<HTMLElement>('[data-auth-action]').forEach((action) => {
    action.addEventListener('click', openAuth)
  })
  composer?.addEventListener('submit', (event) => {
    event.preventDefault()
    openAuth()
  })
}

function showAuthGate(supabase: SupabaseClient, afterAuth?: () => void, onCancel?: () => void): void {
  if (authGateVisible) return
  authGateVisible = true
  el.innerHTML = `<main class="orygin-auth-page">
    <section class="orygin-auth-main" aria-labelledby="orygin-auth-title">
      <div class="orygin-auth-main-inner">
        <div class="orygin-auth-brand-header"><img class="orygin-auth-logo" src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
        <div class="orygin-auth-card">
          <button id="orygin-auth-close" class="orygin-auth-close" type="button" aria-label="Fermer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <div class="orygin-auth-card-header">
            <h1 id="orygin-auth-title">Connexion</h1>
            <p id="orygin-auth-description">Accède à ton espace Orygin.</p>
          </div>
          <div class="orygin-auth-mode" role="tablist" aria-label="Mode d’accès">
            <button id="orygin-auth-login-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="true">Se connecter</button>
            <button id="orygin-auth-signup-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="false">Créer un compte</button>
          </div>
          <form id="orygin-auth-form" class="orygin-auth-form">
            <label class="orygin-auth-field"><span>Adresse email</span>
              <span class="orygin-auth-field-control">
                <input class="orygin-auth-input" name="email" type="email" placeholder="toi@exemple.com" autocomplete="email" required />
              </span>
            </label>
            <label class="orygin-auth-field"><span>Mot de passe</span>
              <span class="orygin-auth-field-control">
                <input class="orygin-auth-input" name="password" type="password" minlength="6" placeholder="Au moins 6 caractères" autocomplete="current-password" required />
                <button id="orygin-auth-password-toggle" class="orygin-auth-password-toggle" type="button" aria-label="Afficher le mot de passe" aria-pressed="false">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                </button>
              </span>
            </label>
            <button id="orygin-auth-submit" class="orygin-auth-submit" type="submit">Se connecter</button>
            <p id="orygin-auth-status" class="orygin-auth-status" role="status" aria-live="polite"></p>
          </form>
          <div class="orygin-auth-card-footer"><span id="orygin-auth-footer-prompt">Pas encore de compte ?</span><button id="orygin-auth-footer-toggle" type="button">Créer un compte</button></div>
        </div>
      </div>
    </section>
  </main>`

  const form = document.getElementById('orygin-auth-form') as HTMLFormElement | null
  const submit = document.getElementById('orygin-auth-submit') as HTMLButtonElement | null
  const loginMode = document.getElementById('orygin-auth-login-mode') as HTMLButtonElement | null
  const signupMode = document.getElementById('orygin-auth-signup-mode') as HTMLButtonElement | null
  const footerToggle = document.getElementById('orygin-auth-footer-toggle') as HTMLButtonElement | null
  const footerPrompt = document.getElementById('orygin-auth-footer-prompt')
  const title = document.getElementById('orygin-auth-title')
  const description = document.getElementById('orygin-auth-description')
  const passwordToggle = document.getElementById('orygin-auth-password-toggle') as HTMLButtonElement | null
  const close = document.getElementById('orygin-auth-close') as HTMLButtonElement | null
  const status = document.getElementById('orygin-auth-status')
  if (
    form === null || submit === null || loginMode === null || signupMode === null
    || footerToggle === null || footerPrompt === null || title === null || description === null
    || passwordToggle === null || close === null || status === null
  ) return

  let signUp = false
  const setMode = (nextSignUp: boolean): void => {
    signUp = nextSignUp
    submit.textContent = signUp ? 'Créer mon compte' : 'Se connecter'
    loginMode.setAttribute('aria-selected', String(!signUp))
    signupMode.setAttribute('aria-selected', String(signUp))
    title.textContent = signUp ? 'Créer un compte' : 'Connexion'
    description.textContent = signUp ? 'Crée ton espace Orygin.' : 'Accède à ton espace Orygin.'
    footerPrompt.textContent = signUp ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'
    footerToggle.textContent = signUp ? 'Se connecter' : 'Créer un compte'
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password !== null) password.autocomplete = signUp ? 'new-password' : 'current-password'
    status.textContent = ''
    status.removeAttribute('data-tone')
  }

  loginMode.addEventListener('click', () => {
    setMode(false)
  })
  signupMode.addEventListener('click', () => {
    setMode(true)
  })
  footerToggle.addEventListener('click', () => {
    setMode(!signUp)
  })
  passwordToggle.addEventListener('click', () => {
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password === null) return
    const visible = password.type === 'text'
    password.type = visible ? 'password' : 'text'
    passwordToggle.setAttribute('aria-pressed', String(!visible))
    passwordToggle.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe')
  })
  close.addEventListener('click', () => {
    authGateVisible = false
    onCancel?.()
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      submit.disabled = true
      status.textContent = signUp ? 'Création du compte…' : 'Connexion…'
      status.removeAttribute('data-tone')
      const emailInput = form.elements.namedItem('email')
      const passwordInput = form.elements.namedItem('password')
      if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
        status.textContent = 'Le formulaire est incomplet. Recharge la page et réessaie.'
        status.setAttribute('data-tone', 'error')
        submit.disabled = false
        return
      }
      const email = emailInput.value.trim()
      const password = passwordInput.value
      const result = signUp
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error !== null) {
        status.textContent = result.error.message
        status.setAttribute('data-tone', 'error')
        submit.disabled = false
        return
      }
      publishSession(result.data.session)
      if (result.data.session === null) {
        status.textContent = 'Compte créé. Vérifie ton email pour confirmer ton inscription.'
        status.setAttribute('data-tone', 'success')
        submit.disabled = false
        return
      }
      if (afterAuth !== undefined) afterAuth()
      else await startApp()
    })().catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.setAttribute('data-tone', 'error')
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
  // Keep the product visible to signed-out visitors. The API remains
  // protected; an action that receives HTTP 401 calls requestAuth below and
  // opens this gate in context. This mirrors the Codex-style flow where
  // authentication is requested at the point of need, not at page load.
  ;(globalThis as AuthGlobal).__ORYGIN_AUTH__ = {
    getAccessToken: () => accessToken,
    requestAuth: () => {
      if (appStarted) showAuthGate(supabase, () => window.location.reload(), () => window.location.reload())
      else showAuthGate(supabase, undefined, () => showGuestShell(supabase))
    },
  }
  if (data.session === null) showGuestShell(supabase)
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
