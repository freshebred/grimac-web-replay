import {defineConfig} from 'vite';
export default defineConfig({server:{proxy:{'/api':'http://127.0.0.1:3000','/auth':'http://127.0.0.1:3000'}},build:{target:'es2022',rollupOptions:{output:{manualChunks:{three:['three']}}}}});
