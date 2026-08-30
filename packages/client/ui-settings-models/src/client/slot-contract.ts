/** Extension seats exposed by the Models page to provider companion plugins. */
import type { ConfigurableProviderView } from '@orygin-ai/dsh-api-remotes/client'

declare module '@orygin-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Extra controls rendered inside each saved or dormant provider card. */
    'settings.models.provider-card': { kind: 'keyed'; scope: 'root'; owner: ProviderCardExtrasOwnerProps }
    /** Ordered content rendered after provider rows and add controls. */
    'settings.models.footer': { kind: 'list'; scope: 'root'; owner: ModelsFooterOwnerProps }
  }
}

export interface ProviderCardExtrasOwnerProps {
  provider: ConfigurableProviderView
  configured: boolean
  keyConfigured: boolean
}

export interface ModelsFooterOwnerProps { children?: never }
