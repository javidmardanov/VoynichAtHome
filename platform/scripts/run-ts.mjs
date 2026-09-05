// Run local operational tooling through the already-pinned Vite TypeScript toolchain.
import { createServer } from 'vite';
const server=await createServer({configFile:false,server:{middlewareMode:true}});
try{await server.ssrLoadModule(process.argv[2]);}finally{await server.close();}
