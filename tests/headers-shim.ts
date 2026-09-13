import {context} from './runtime-harness';
export async function headers(){const id=context.getStore();return new Headers(id?{'oai-authenticated-user-id':id}:{});}
