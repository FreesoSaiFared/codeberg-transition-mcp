import {loadConfig} from './config.mjs';
import {Api} from './api.mjs';
const c=loadConfig();
const api=new Api(c);
const report=await api.capabilities();
console.log(JSON.stringify({service:'codeberg-transition-mcp',node:process.version,platform:process.platform,...report},null,2));
