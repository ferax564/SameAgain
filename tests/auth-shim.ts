import {context} from './runtime-harness';
export async function getChatGPTUser(){const id=context.getStore();return id?{displayName:id,email:id+'@example.test'}:null}
