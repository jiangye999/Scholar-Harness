import { buildOfficeCliRuntimeEnv } from './office-runtime-env';
import { buildPythonRuntimeEnv } from './python-runtime-env';
import { buildRRuntimeEnv } from './r-runtime-env';

export function buildToolRuntimeEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return buildOfficeCliRuntimeEnv(buildPythonRuntimeEnv(buildRRuntimeEnv(baseEnv)));
}
