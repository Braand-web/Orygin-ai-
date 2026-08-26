import { staticLinked } from '../tsdown.client.ts'

export default staticLinked(
  '@orygin-ai/dsh-client-web',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
