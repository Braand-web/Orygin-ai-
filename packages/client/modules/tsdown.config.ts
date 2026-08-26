import { clientBundle } from '../tsdown.client.ts'

export default clientBundle(
  '@orygin-ai/dsh-client-modules',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
