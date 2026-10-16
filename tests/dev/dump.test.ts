import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { buildPrelude } from '../../src/engine/prelude';
it.skipIf(!process.env.TRY)('dump', () => { writeFileSync('/tmp/prelude.txt', buildPrelude(readFileSync(process.env.TRY!, 'utf8'))); });
