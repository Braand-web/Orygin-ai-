import { clientLibrary } from '../../client/tsdown.client.ts'

export default clientLibrary(
  '@orygin-ai/dsh-client-test-runtime',
  ['lib/types/index.js', 'lib/types/invariant.js'],
)
