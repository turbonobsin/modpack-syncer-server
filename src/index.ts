import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { util_lstat, util_mkdir, util_readBinary, util_readdir, util_readdirWithTypes, util_readJSON, util_utimes, util_warn, util_writeBinary, util_writeJSON } from "./util";
import { modpackCache } from "./cache";
import { errors, Result } from "./errors";
import path from "path";

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
    // socket.on("msg",msg=>{
    //     console.log("got msg: ",msg);
    // });

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

    // sync
    onEv<{id:string,update:number},boolean>(socket,"checkModUpdates",async (arg,call)=>{
        if(arg.update == undefined) arg.update = 0;

        let pack = (await modpackCache.get(arg.id)).unwrap();
        if(!pack){
            call(errors.couldNotFindPack);
            return;
        }

        if(pack.meta.update > arg.update) call(new Result(true));
        else call(new Result(false));
    });
    onEv<Arg_GetModUpdates,Res_GetModUpdates>(socket,"getModUpdates",async (arg,call)=>{
        let currentMods:string[] = [];
        let currentIndexes:string[] = [];

        let rootPath = path.join("..","modpacks",arg.id);
        if(!rootPath) return errors.unknown;

        let _curMods = await util_readdirWithTypes(path.join(rootPath,"mods"));
        let _curIndexes = await util_readdir(path.join(rootPath,"mods",".index"));
        for(const mod of _curMods){
            if(!mod.isFile()) continue;
            currentMods.push(mod.name);
        }
        for(const index of _curIndexes){
            currentIndexes.push(index);
        }

        // 
        let data:Res_GetModUpdates = {
            mods:{
                add:[],
                remove:[]
            },
            indexes:{
                add:[],
                remove:[]
            }
        };
        for(const mod of currentMods){
            if(arg.ignoreMods.includes(mod)) continue;
            if(!arg.currentMods.includes(mod)) data.mods.add.push(mod);
        }
        for(const mod of arg.currentMods){
            if(arg.ignoreMods.includes(mod)) continue;
            if(!currentMods.includes(mod)) data.mods.remove.push(mod);
        }
        for(const index of currentIndexes){
            if(!arg.currentIndexes.includes(index)) data.indexes.add.push(index);
        }
        for(const index of arg.currentIndexes){
            if(!currentIndexes.includes(index)) data.indexes.remove.push(index);
        }

        call(new Result(data));
    });

    // resource packs
    onEv<Arg_UploadRP,Res_UploadRP>(socket,"uploadRP",async (arg,call)=>{
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d){
            call(errors.invalid_args);
            return;
        }
        if(!d.mp){
            call(errors.invalid_args);
            return;
        }
        if(!d.userAuth){
            call(errors.invalid_args);
            return;
        }

        let {userAuth,mp} = d;
        
        if(!userAuth.uploadRP){
            call(errors.denyAuth);
            return;
        }

        let existingRP = d.mp.meta_og._resourcepacks.find(v=>v.rpID == arg.name);
        if(existingRP){
            let ableToUpload = false;
            if(existingRP.ownerUID == arg.uid) ableToUpload = true;
            if(!ableToUpload){
                let perm = existingRP._perm.users.find(v=>v.uid == arg.uid || v.uname == arg.uname);
                if(perm){
                    if(perm.upload) ableToUpload = true;
                }
            }
            
            if(!ableToUpload){
                call(errors.rpAlreadyExists);
                return;
            }
        }

        // create meta
        let cacheMeta = d.mp.meta_og._resourcepacks.find(v=>v.rpID == arg.name)
        if(!cacheMeta){
            cacheMeta = {
                _perm:{
                    users:[]
                },
                ownerUID:arg.uid,
                rpID:arg.name,
                update:0
            };
            d.mp.meta_og._resourcepacks.push(cacheMeta);

        }
        cacheMeta.update++;
        await d.mp.save();

        // 
        // let cachePath = path.join("..","modpacks",arg.mpID,"cache","rp",arg.name);
        // if(!await util_lstat(cachePath)) 
        
        // we're all good to start requesting upload now
        if(!await util_lstat(path.join("..","modpacks",arg.mpID,"resourcepacks",arg.name))) call(new Result({
            res:2,
            update:cacheMeta.update
        }));
        else call(new Result({
            res:1,
            update:cacheMeta.update
        }));
    });

    onEv<Arg_UploadRPFile,boolean>(socket,"upload_rp_file",async (arg,call)=>{
        if(arg.path.includes("..")){
            call(errors.invalid_args);
            return;
        }

        // AUTH CHECK
        if(!arg.uid || !arg.uname){
            call(new Result(false));
            return;
        }
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d){
            call(new Result(false));
            return;
        }
        let {userAuth} = d;
        
        if(!userAuth.uploadRP){
            call(errors.denyAuth);
            return;
        }
        // 

        arg.path = arg.path.substring(1);
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpName,arg.path);

        let res = await util_mkdir(path.dirname(loc),true);
        if(!res) call(new Result(false));
        
        res = await util_writeBinary(loc,Buffer.from(arg.buf));
        let stat = await util_lstat(loc);
        // if(stat) console.log("STAT: ",arg.path,new Date(stat.mtimeMs),new Date(stat.birthtimeMs),new Date(arg.mt),new Date(arg.bt));
        let utimes_res = await util_utimes(loc,{ atime:arg.at, mtime:arg.mt, btime:arg.bt });

        call(new Result(res));
    });
    onEv<Arg_DownloadRPFile,ModifiedFileData>(socket,"download_rp_file",async (arg,call)=>{
        if(arg.path.includes("..") || arg.mpID.includes("..") || arg.rpName.includes("..")){
            call(errors.invalid_args);
            return;
        }

        if(arg.path[0] == "/") arg.path = arg.path.substring(1);
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpName,arg.path);

        let buf = await util_readBinary(loc);
        if(!buf){
            util_warn("ERR: could not read file: "+loc);
            call(errors.fileDNE);
            return;
        }

        let stats = await util_lstat(loc);
        if(!stats){
            call(errors.failedToReadStats);
            return;
        }

        call(new Result({
            at:stats.atimeMs,
            mt:stats.mtimeMs,
            buf
        }));
    });

    onEv<Arg_DownloadRP,Res_DownloadRP>(socket,"downloadRP",async (arg,call)=>{
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpID);
        if(!await util_lstat(loc)){
            call(errors.couldNotFindRP);
            return;
        }

        // 
        let root = new FFolder("root");
        let addFiles:ModifiedFile[] = [];
        let removeFiles:ModifiedFile[] = [];

        const read = async (f:FFolder,loc:string,loc2:string)=>{
            let ar = await util_readdirWithTypes(loc);
            for(const item of ar){
                if(item.isFile()){
                    let fileLoc = path.join(loc,item.name);
                    let stat = await util_lstat(fileLoc);
                    if(!stat) continue;

                    // let subLoc = (loc2[0] == "/" ? loc2.substring(1) : loc2)+"/"+item.name;
                    // let cc = arg.data[subLoc];
                    // if(!cc){
                    //     cc = {
                    //         download:0,
                    //         modified:0,
                    //         upload:0,
                    //     };
                    //     console.log("ERR: NO CC: ",subLoc);
                    // }
                    // if(Math.max(stat.mtimeMs,stat.birthtimeMs) <= cc.download) continue; // SKIP if it hasn't been modified
                    // if(Math.max(stat.mtimeMs,stat.birthtimeMs) <= arg.lastDownloaded) continue; // SKIP if it hasn't been modified
                    if(!arg.force) if(stat.mtimeMs <= arg.lastDownloaded) continue; // SKIP if it hasn't been modified
                    
                    // totalFiles++;
                    let buf = await util_readBinary(fileLoc);
                    let file = new FFile(item.name,buf);
                    f.items.push(file);
                    addFiles.push({
                        n:item.name,
                        l:loc2+"/"+item.name,
                        mt:stat.mtimeMs,
                        bt:stat.birthtimeMs,
                        at:stat.atimeMs,
                    });
                }
                else{
                    // totalFolders++;
                    let folder = new FFolder(item.name);
                    f.items.push(folder);
                    await read(folder,path.join(loc,item.name),loc2+"/"+item.name);
                }
            }
        };
        await read(root,loc,"");
        //

        for(const v of addFiles) v.l = v.l.replace(loc,"");
        // for(const v of addFiles) v.l = path.relative(loc,v.l);
        // for(const v of removeFiles) v.l = path.relative(loc,v.l);

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst){
            call(errors.couldNotFindPack);
            return;
        }
        let cacheMeta = inst.meta_og._resourcepacks.find(v=>v.rpID == arg.rpID);
        if(!cacheMeta){
            call(errors.couldNotFindRP);
            return;
        }

        call(new Result({
            add:addFiles,
            remove:removeFiles,
            update:cacheMeta.update
        }));
    });

    onEv<Arg_GetRPs,Res_GetRPs>(socket,"getRPs",async (arg,call)=>{
        let mp = (await modpackCache.get(arg.mpID)).unwrap();
        if(!mp){
            call(errors.couldNotFindPack);
            return;
        }

        let data:Res_GetRPs = {
            list:[]
        };

        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks");
        let items = await util_readdir(loc);
        for(const item of items){
            if(arg.existing.includes(item)) continue;

            let meta = await util_readJSON<RP_MCMeta>(path.join(loc,item,"pack.mcmeta"));
            if(meta){
                data.list.push({
                    name:item,
                    data:{
                        icon:"",
                        meta:{
                            pack:{
                                description:meta.pack.description ?? "",
                                pack_format:meta.pack.pack_format ?? -1
                            }
                        },
                        sync:{
                            rpID:item
                        }
                    }
                });
            }
        }

        call(new Result(data));
    });

    onEv<Arg_GetRPVersions,Res_GetRPVersions>(socket,"getRPVersions",async (arg,call)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst){
            call(errors.couldNotFindPack);
            return;
        }

        let res:Res_GetRPVersions = {
            versions:[]
        };

        for(const cur of arg.current){
            let rp = inst.meta_og._resourcepacks.find(v=>v.rpID == cur.rpID);
            if(!rp) continue;

            if(rp.update <= cur.update) continue; // doesn't need an update

            res.versions.push({
                rpID:rp.rpID,
                update:rp.update
            });
        }

        call(new Result(res));
    });

    // 
    socket.on("getPack",()=>{
        
    });
});

const port = 3001;

async function getUserAuth(mpID:string,uid:string,uname:string,call:(data:any)=>void){
    let mp = (await modpackCache.get(mpID)).unwrap();
    if(!mp) return;

    if(!mp.meta_og._perm?.users){
        call(errors.noAuthSet);
        return;
    }

    let userAuth = mp.meta_og._perm.users.find(v=>v.uid == uid || v.uname == uname);
    if(!userAuth){
        call(errors.noAuthFound);
        return;
    }

    return {mp,userAuth};
}

// app.post("/upload_rp",(req,res)=>{
//     console.log(req.query);
//     res.send({
//         text:"this is the res"
//     });
// });

app.get("/image",(req,res)=>{
    // req.params.id
    // let url = `localhost:${port}/test_images/2024-01-13_15.49.30.png`;

    // console.log("URL:",url);

    // res.send({ url });
    res.sendFile(path.join(__dirname,"..","test_images","2024-01-13_15.49.30.png"));
});
app.use("/test",express.static("../test_images"));

app.get("/mod",(req,res)=>{
    let packID = req.query.id;
    let name = req.query.name;

    if(!packID || !name || typeof packID != "string" || typeof name != "string"){
        res.sendStatus(400); // bad request
        return;
    }
    
    res.sendFile(path.join(__dirname,"..","modpacks",packID,"mods",name));
});
app.get("/modindex",(req,res)=>{
    let packID = req.query.id;
    let name = req.query.name;

    if(!packID || !name || typeof packID != "string" || typeof name != "string"){
        res.sendStatus(400); // bad request
        return;
    }
    
    res.sendFile(path.join(__dirname,"..","modpacks",packID,"mods",".index",name));
    // res.sendFile(path.join(__dirname,"..","modpacks",packID,"mods",".index","fake_folder",name)); // <-- THIS IS DEBUG FOR FORCING A FAIL TO HAPPEN
});
app.get("/rp_image",(req,res)=>{
    let mpID = req.query.mpID?.toString();
    let rpID = req.query.rpID?.toString();
    if(!mpID || !rpID){
        res.sendStatus(400);
        return;
    }

    res.sendFile(path.join(__dirname,"..","modpacks",mpID,"resourcepacks",rpID,"pack.png"));
});

server.listen(port,()=>{
    console.log(`Server listening on port ${port}`);
});

// 
class FItem{
    constructor(name:string){
        this.name = name;
    }
    name:string;
}
class FFolder extends FItem{
    constructor(name:string){
        super(name);
        this.items = [];
    }
    items:FItem[];
}
class FFile extends FItem{
    constructor(name:string,buf:Uint8Array){
        super(name);
        this.buf = buf;
    }
    buf:Uint8Array;
}