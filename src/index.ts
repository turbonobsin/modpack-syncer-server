import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { util_lstat, util_readJSON } from "./util";
import { modpackCache } from "./cache";
import { errors, Result } from "./errors";

const app = express();
const server = createServer(app);
const io = new Server(server,{
    maxHttpBufferSize:3e8 // 300 MB
});

app.get("/",(req,res)=>{
    res.send("<h1>Hello World</h1>");
});

type CB<T> = (err:Result<T>)=>void;

function onEv<T,V>(socket:Socket,ev:string,f:(arg:T,call:CB<V>)=>void){
    socket.on(ev,async (arg:T,call:CB<V>)=>{
        if(!call) return;
        if(!arg){
            call(errors.invalid_args);
            return;
        }
        f(arg,call);
    });
}

io.on("connection",socket=>{
    socket.on("msg",msg=>{
        console.log("got msg: ",msg);
    });

    // 
    socket.on("getPackMetas",()=>{
        
    });
    socket.on("getPackMeta",async (id:string,call:CB<PackMetaData>)=>{
        // let cache = modpackCache.findLike(id);
        let cache = (await modpackCache.get(id)).unwrap(call);
        if(!cache) return;
        
        call(new Result(cache.meta));
    });

    onEv<Arg_SearchPacks,Res_SearchPacks>(socket,"searchPacks",(arg,call)=>{
        let res = modpackCache.findLike(arg.query);
        
        call(new Result({
            similar:res
        }));
    });
    onEv<Arg_SearchPacks,Res_SearchPacksMeta>(socket,"searchPacksMeta",async (arg,call)=>{
        let res = await modpackCache.getLike(arg.query);
        call(new Result({
            similar:res.map(v=>v.meta)
        }));
    });

    socket.on("getPack",()=>{
        
    });
});

server.listen(3000,()=>{
    console.log("Server listening on port 3000");
});