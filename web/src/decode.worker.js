import {decodeBundle} from './bundle.js';
self.onmessage=async({data})=>{try{self.postMessage({bundle:await decodeBundle(data)});}catch(e){self.postMessage({error:e.message});}};
