import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import { util_lstat, util_mkdir, util_readBinary, util_readdir, util_readdirWithTypes, util_readJSON, util_rm, util_utimes, util_warn, util_writeBinary, util_writeJSON } from "./util";
import { configFile, modpackCache, userCache } from "./cache";
import { errors, Result } from "./errors";
import path from "path";
import formidable from "formidable";

const app = express();
const server = createServer(app);
const io = new Server(server,{
    maxHttpBufferSize:3e8 // 300 MB
});

app.get("/",(req,res)=>{
    res.send("<h1>Hello World</h1>");
});

type CB<T> = (err:Result<T>)=>void;

// function onEv<T,V>(socket:Socket,ev:string,f:(arg:T,call:CB<V>)=>void|Promise<void>){
function onEv<T,V>(socket:Socket,ev:string,f:(arg:T,call:CB<V>)=>Promise<Result<V>>){
    socket.on(ev,async (arg:T,call:CB<V>)=>{
        if(!call) return;
        if(!arg){
            call(errors.invalid_args);
            return;
        }
        let alreadyCalled = false;
        let res = await f(arg,(err:Result<V>)=>{
            alreadyCalled = true;
            call(err);
        });
        if(alreadyCalled) return;
        if(!res) call(errors.unknown);
        else call(res);
    });
}

io.on("connection",socket=>{
    // socket.on("msg",msg=>{
    //     console.log("got msg: ",msg);
    // });

    onEv<Arg_Connection,boolean>(socket,"connectUser",async (arg)=>{
        console.log("User Connect:",arg.uid,arg.uname);
        let res = !!userCache.connect(socket.id,arg);
        return new Result(res);
    });
    socket.on("disconnect",()=>{
        userCache.disconnect(socket.id);
        // console.log("Disconnect: "+socket.id);
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

    onEv<Arg_SearchPacks,Res_SearchPacks>(socket,"searchPacks",async (arg)=>{        
        let res = modpackCache.findLike(arg.query,arg.uid,arg.uname);
        
        return new Result({
            similar:res
        });
    });
    onEv<Arg_SearchPacks,Res_SearchPacksMeta>(socket,"searchPacksMeta",async (arg)=>{
        let res = await modpackCache.getLike(arg.query,arg.uid,arg.uname);
        let metas = res.map(v=>v.meta);
        return new Result({
            similar:metas
        });
    });

    onEv<Arg_GetWorldMeta,Res_GetWorldMeta>(socket,"getWorldMeta",async (arg)=>{
        if(!arg) return errors.invalid_args;
        if(!arg.mpID) return errors.invalid_args;
        if(!arg.wID) return errors.invalid_args;
        
        let cacheRes = await modpackCache.get(arg.mpID);
        if(cacheRes.err) return cacheRes;
        let cache = cacheRes.unwrap();
        if(!cache) return errors.couldNotFindPack;

        let w = cache.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return new Result({
            isPublished:false,
            wID:arg.wID,
        });
        let wMeta:WorldMeta = {
            icon:w.icon,
            ownerUID:w.ownerUID,
            ownerName:w.ownerName,
            update:w.update,
            publisherName:w.publisherName
        };

        return new Result({
            isPublished:true,
            wID:arg.wID,
            data:wMeta,
            state:w.state
        });
    });

    // sync
    onEv<{id:string,update:number},boolean>(socket,"checkModUpdates",async (arg)=>{
        if(arg.update == undefined) arg.update = 0;

        let pack = (await modpackCache.get(arg.id)).unwrap();
        if(!pack) return errors.couldNotFindPack;

        if(pack.meta.update > arg.update) return new Result(true);
        return new Result(false);
    });
    onEv<Arg_GetModUpdates,Res_GetModUpdates>(socket,"getModUpdates",async (arg)=>{
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

        return new Result(data);
    });

    // resource packs
    onEv<Arg_UploadRP,Res_UploadRP>(socket,"uploadRP",async (arg,call)=>{
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return errors.invalid_args;
        if(!d.mp) return errors.couldNotFindPack;
        if(!d.userAuth) return errors.noAuthFound;

        if(arg.name.endsWith(".disabled")) return errors.noDisabledRP;

        let {userAuth,mp} = d;

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
            
            if(!ableToUpload) return errors.rpAlreadyExists;
        }
        else{
            if(!userAuth.uploadRP) return errors.denyAuth;
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
        if(!await util_lstat(path.join("..","modpacks",arg.mpID,"resourcepacks",arg.name))) return new Result({
            res:2,
            update:cacheMeta.update
        });
        return new Result({
            res:1,
            update:cacheMeta.update
        });
    });

    onEv<Arg_UploadRPFile,boolean>(socket,"upload_rp_file",async (arg,call)=>{
        if(arg.path.includes("..") || arg.mpID.includes("..") || arg.rpName.includes("..")) return errors.invalid_args;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadRP) return errors.denyAuth;
        else{
            let permData = d.mp.meta_og._resourcepacks.find(v=>v.rpID == arg.rpName);
            if(!permData) return errors.denyAuth;
            if(permData.ownerUID != arg.uid){
                let perm = permData._perm.users.find(v=>v.uid == arg.uid || v.uname == arg.uname);
                if(!perm) return errors.denyAuth;
                if(!perm.upload) return errors.denyAuth;
            }
        }
        // 

        arg.path = fixPath(arg.path);
        if(arg.path[0] == "/") arg.path = arg.path.substring(1);
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpName,arg.path);

        let res = await util_mkdir(path.dirname(loc),true);
        if(!res) return new Result(false);
        
        res = await util_writeBinary(loc,Buffer.from(arg.buf));
        // let stat = await util_lstat(loc);
        // if(stat) console.log("STAT: ",arg.path,new Date(stat.mtimeMs),new Date(stat.birthtimeMs),new Date(arg.mt),new Date(arg.bt));
        // let utimes_res = await util_utimes(loc,{ atime:arg.at, mtime:arg.mt, btime:arg.bt });

        return new Result(res);
    });
    onEv<Arg_DownloadRPFile,ModifiedFileData>(socket,"download_rp_file",async (arg)=>{
        if(arg.path.includes("..") || arg.mpID.includes("..") || arg.rpName.includes("..")) return errors.invalid_args;

        arg.path = fixPath(arg.path);
        if(arg.path[0] == "/") arg.path = arg.path.substring(1);
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpName,arg.path);

        let buf = await util_readBinary(loc);
        if(!buf){
            util_warn("ERR: could not read file: "+loc);
            return errors.fileDNE;
        }

        let stats = await util_lstat(loc);
        if(!stats){
            return errors.failedToReadStats;
        }

        return new Result({
            at:stats.atimeMs,
            mt:stats.mtimeMs,
            buf
        });
    });

    onEv<Arg_DownloadRP,Res_DownloadRP>(socket,"downloadRP",async (arg)=>{
        let loc = path.join("..","modpacks",arg.mpID,"resourcepacks",arg.rpID);
        if(!await util_lstat(loc)) return errors.couldNotFindRP;

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
        if(!inst) return errors.couldNotFindPack;

        let cacheMeta = inst.meta_og._resourcepacks.find(v=>v.rpID == arg.rpID);
        // if(!cacheMeta) return errors.couldNotFindRP; // <-- this is disabled bc if not, then if a pack failed to upload you wouldn't be able to download it

        return new Result({
            add:addFiles,
            remove:removeFiles,
            update:cacheMeta?.update ?? 0
        });
    });

    onEv<Arg_GetRPs,Res_GetRPs>(socket,"getRPs",async (arg)=>{
        let mp = (await modpackCache.get(arg.mpID)).unwrap();
        if(!mp) return errors.couldNotFindPack;

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

        return new Result(data);
    });

    onEv<Arg_GetRPVersions,Res_GetRPVersions>(socket,"getRPVersions",async (arg,call)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap(call);
        if(!inst) return errors.couldNotFindPack;

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

        return new Result(res);
    });

    // Worlds
    onEv<Arg_GetAllowedDirs,boolean>(socket,"getAllowedDirs",async (arg)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        if(arg.wID.endsWith(".disabled")) return errors.noDisabledWorld;

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE;
        if(w.ownerUID != arg.uid){
            return errors.denyWorldUpload;
        }

        /////// this is basically the startUploadWorld event

        return new Result(w.allowedDirs);
    });
    onEv<SArg_PublishWorld,boolean>(socket,"publishWorld",async (arg,call)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        if(arg.wID.endsWith(".disabled")) return errors.noDisabledWorld;

        // AUTH CHECK
        if(!arg.ownerUID || !arg.ownerName) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.ownerUID,arg.ownerName,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        if(inst.meta_og._worlds.some(v=>v.wID == arg.wID)) return errors.alreadyPublishedWorld;
        let w:SWorldMeta = {
            wID:arg.wID,
            ownerUID:arg.ownerUID,
            ownerName:arg.ownerName,
            icon:"icon.png",
            _perm:{
                users:[]
            },
            update:0,
            lastSync:-1,
            updateTime:Date.now(),
            publisherUID:arg.ownerUID,
            publisherName:arg.ownerName,
            allowedDirs:arg.allowedDirs,
            state:""
        };

        inst.meta_og._worlds.push(w);
        await inst.save();

        return new Result(true);
    });
    function validatePath(loc:string){
        if(loc.includes("..")) return false;
        return true;
    }
    onEv<Arg_UnpublishRP,boolean>(socket,"unpublishRP",async (arg)=>{
        if(!validatePath(arg.mpID) || !validatePath(arg.rpID)) return errors.invalid_args;
        
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        let w = inst.meta_og._resourcepacks.find(v=>v.rpID == arg.rpID);
        // vvv - this is disabled for now because there's a chance that the pack was uploaded but it's not in the array so commenting this out will allow you to fix the glitch
        // if(!w) return errors.couldNotFindRP;

        if(w){
            if(w.ownerUID != arg.uid) return errors.denyAuth;

            let ind = inst.meta_og._resourcepacks.findIndex(v=>v.rpID == arg.rpID);
            if(ind != -1){
                inst.meta_og._resourcepacks.splice(ind,1);
                await inst.save();
            }
        }

        let loc = path.join("../modpacks",arg.mpID,"resourcepacks",arg.rpID);
        let res = await util_rm(loc,true);
        
        return new Result(res);
    });
    onEv<Arg_UnpublishWorld,boolean>(socket,"unpublishWorld",async (arg)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE;

        if(w.publisherUID != arg.uid) return errors.denyAuth;

        let ind = inst.meta_og._worlds.findIndex(v=>v.wID == arg.wID);
        if(ind != -1){
            inst.meta_og._worlds.splice(ind,1);
            await inst.save();
        }

        return new Result(true);
    });
    onEv<Arg_UploadWorldFile,boolean>(socket,"upload_world_file",async (arg,call)=>{        
        if(arg.path.includes("..") || arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        arg.path = fixPath(arg.path);
        let loc = path.join("..","modpacks",arg.mpID,"saves",arg.wID,arg.path);

        let res = await util_mkdir(path.dirname(loc),true);
        if(!res) return new Result(false);
        
        res = await util_writeBinary(loc,Buffer.from(arg.buf));
        // let stat = await util_lstat(loc);
        // if(stat) console.log("STAT: ",arg.path,new Date(stat.mtimeMs),new Date(stat.birthtimeMs),new Date(arg.mt),new Date(arg.bt));
        // let utimes_res = await util_utimes(loc,{ atime:arg.at, mtime:arg.mt, btime:arg.bt });

        return new Result(res);
    });
    ////////
    onEv<Arg_LaunchInst,boolean>(socket,"startLaunchInst",async (arg,call)=>{
        if(arg.mpID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        let unownedWorlds = inst.meta_og._worlds.filter(v=>v.ownerUID != arg.uid);
        let worlds = inst.meta_og._worlds;

        if(unownedWorlds.length){
            // you are launching an instance with worlds you don't own. Here be dragons!
            return errors.denyLaunchFromUnownedWorlds;
        }
        if(worlds.some(v=>v.state != "")) return errors.notAllWorldsAreAvailable;

        for(const w of worlds){
            w.state = "inUse";
            updateWorldSearch(arg.mpID,w.wID);
            await inst.save();
        }

        return new Result(true);
    });
    onEv<Arg_LaunchInst,boolean>(socket,"finishLaunchInst",async (arg,call)=>{
        if(arg.mpID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        let worlds = inst.meta_og._worlds;

        for(const w of worlds){
            // not sure if I need to check here if w.state != "inUse" then error, because it should probably be guarenteed at this point that the state is "inUse"
            if(w.ownerUID != arg.uid) continue; // if the case happens, you CANNOT modify worlds that you don't own
            w.state = "";
            updateWorldSearch(arg.mpID,w.wID);
            await inst.save();
        }

        return new Result(true);
    });
    onEv<Arg_FinishUploadWorld,boolean>(socket,"forceFixBrokenWorldState",async (arg,call)=>{
        if(arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE.unwrap();
        // if(w.publisherUID != arg.uid){
        //     return errors.denyPublisherAuth;
        // }
        if(arg.uid != w.publisherUID && arg.uid != w.ownerUID){
            return errors.denyAuth;
        }

        if(w.state == "") return errors.noChangeMade;

        w.state = "";
        updateWorldSearch(arg.mpID,arg.wID);
        await inst.save();

        return new Result(true);
    });
    onEv<Arg_FinishUploadWorld,boolean>(socket,"startUploadWorld",async (arg,call)=>{
        if(arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        if(arg.wID.endsWith(".disabled")) return errors.noDisabledWorld;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE.unwrap();
        if(w.ownerUID != arg.uid){
            return errors.denyWorldUpload;
        }

        if(w.state != "") return errors.worldIsNotAvailableState;

        w.state = "uploading";
        updateWorldSearch(arg.mpID,arg.wID);
        await inst.save();

        return new Result(true);
    });
    onEv<Arg_FinishUploadWorld,boolean>(socket,"startDownloadWorld",async (arg,call)=>{
        if(arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE.unwrap();
        if(w.ownerUID != arg.uid){
            return errors.denyWorldUpload;
        }

        if(w.state != "") return errors.worldIsNotAvailableState;

        w.state = "downloading";
        updateWorldSearch(arg.mpID,arg.wID);
        await inst.save();

        return new Result(true);
    });
    onEv<Arg_FinishUploadWorld,boolean>(socket,"finishDownloadWorld",async (arg,call)=>{
        if(arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE.unwrap();
        if(w.ownerUID != arg.uid){
            return errors.denyWorldUpload;
        }

        if(w.state != "downloading") return errors.cantFinishWorldDownload;

        w.state = "";
        updateWorldSearch(arg.mpID,arg.wID);
        await inst.save();

        return new Result(true);
    });
    onEv<Arg_FinishUploadWorld,Res_FinishUploadWorld>(socket,"finishUploadWorld",async (arg,call)=>{
        if(arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid || !arg.uname) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE.unwrap();
        if(w.ownerUID != arg.uid){
            return errors.denyWorldUpload;
        }

        w.update++;
        w.lastSync = Date.now();
        if(w.state == "uploading") w.state = "";
        await inst.save();

        io.except(socket.id).emit("updateSearch",{
            mpID:arg.mpID,
            id:"world",
            data:{
                wID:arg.wID
            }
        });

        return new Result({
            update:w.update
        });
    });

    function updateWorldSearch(mpID:string,wID:string){
        io.emit("updateSearch",{
            mpID,
            id:"world",
            data:{ wID }
        });
    }

    function fixPath(loc:string){
        return loc.replaceAll("\\","/");
    }

    onEv<Arg_DownloadWorldFile,ModifiedFileData>(socket,"download_world_file",async (arg)=>{
        if(arg.path.includes("..") || arg.mpID.includes("..") || arg.wID.includes("..")) return errors.invalid_args;

        arg.path = fixPath(arg.path);
        if(arg.path[0] == "/") arg.path = arg.path.substring(1);
        let loc = path.join("..","modpacks",arg.mpID,"saves",arg.wID,arg.path);

        let buf = await util_readBinary(loc);
        if(!buf){
            util_warn("ERR: could not read file: "+loc);
            return errors.fileDNE;
        }

        let stats = await util_lstat(loc); // might depricate stats?
        if(!stats){
            return errors.failedToReadStats;
        }

        return new Result({
            at:stats.atimeMs,
            mt:stats.mtimeMs,
            buf
        });
    });
    onEv<Arg_GetWorldFiles,Res_GetWorldFiles>(socket,"getWorldFiles",async (arg)=>{ // this is basically the startDownloadWorld
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // if(arg.forceAllFiles) arg.useTime = false; // might not need this

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE;
        // 

        if(w.state != "") return errors.worldIsNotAvailableState;

        if(w.ownerUID != arg.uid){
            return errors.denyWorldDownload;
        }

        let saveLoc = path.join("..","modpacks",arg.mpID,"saves",arg.wID);
        if(!await util_lstat(saveLoc)) return errors.worldDNE;
        
        let res:Res_GetWorldFiles = {
            files:[],
            update:w.update
        };
    
        let rootList = await util_readdir(saveLoc);
        let loop = async (loc:string,sloc:string)=>{
            let list = await util_readdirWithTypes(loc);
            for(const item of list){
                if(item.isDirectory()){
                    await loop(path.join(loc,item.name),path.join(sloc,item.name));
                    continue;
                }
                if(arg.useTime){
                    let stat = await util_lstat(path.join(loc,item.name));
                    if(!stat){
                        util_warn("This error should never happen, failed to open stats after just detecting it was there: "+loc+" "+item.name);
                        continue;
                    }
                    if(Math.max(stat.mtimeMs,stat.birthtimeMs) <= arg.syncTime) continue; // skip
                }
                res.files.push({
                    loc:path.join(loc,item.name),
                    sloc:path.join(sloc,item.name),
                    n:item.name
                });
            }
        };
        if(arg.forceAllFiles){
            await loop(saveLoc,"");
        }
        else for(const f of rootList){
            if(!w.allowedDirs.includes(f)) continue; // THIS IS DISABLED FOR THE FIRST PUBLISH AND FIRST DOWNLOAD
            await loop(path.join(saveLoc,f),f);
        }

        // if(res){
        //     w.state = "downloading";
        //     updateWorldSearch(arg.mpID,arg.wID);
        //     await inst.save();
        // }
        
        return new Result(res);
    });
    onEv<SArg_GetServerWorlds,Res_GetServerWorlds>(socket,"getServerWorlds",async (arg,call)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // // AUTH CHECK
        // if(!arg.uid || !arg.uname) return new Result(false);
        // let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call);
        // if(!d) return new Result(false);
        // let {userAuth} = d;
        
        // if(!userAuth.uploadRP) return errors.denyAuth;
        // // 
        
        let res:Res_GetServerWorlds = {
            list:[]
        };

        for(const w of inst.meta_og._worlds){
            if(arg.existing.includes(w.wID)) continue;
            res.list.push({
                wID:w.wID,
                icon:w.icon,
                ownerName:w.ownerName,
                publisherName:w.publisherName,
                update:w.update,
                state:w.state
            });
        }

        return new Result(res);
    });
    onEv<Arg_SetWorldState,boolean>(socket,"setWorldState",async (arg,call)=>{
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid) return new Result(false);
        let d = await getUserAuth(arg.mpID,arg.uid,undefined,call); // only verify by uid
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE;

        if(w.ownerUID != arg.uid) return errors.denyChangeWorldState;

        // let perm = w._perm.users.find(v=>v.uid == arg.uid);
        // if(!perm) return errors.noAuthFound;

        // if(!perm.upload) return errors.denyAuth;
        //////

        w.state = arg.state;
        await inst.save();

        io.emit("updateSearch",{
            mpID:arg.mpID,
            id:"world",
            data:{
                wID:arg.wID
            }
        });

        return new Result(true);
    });
    onEv<Arg_TakeWorldOwnership,boolean>(socket,"takeWorldOwnership",async (arg,call)=>{
        console.log("TAKE WORLD OWNERSHIP:",arg);
        
        let inst = (await modpackCache.get(arg.mpID)).unwrap();
        if(!inst) return errors.couldNotFindPack;

        // AUTH CHECK
        if(!arg.uid && !arg.uname){
            console.log("FAILED ARG?",arg);
            return new Result(false);
        }
        let d = await getUserAuth(arg.mpID,arg.uid,arg.uname,call); // only verify by uid
        if(!d) return new Result(false);
        let {userAuth} = d;
        
        if(!userAuth.uploadWorld) return errors.denyAuth;
        // 

        let w = inst.meta_og._worlds.find(v=>v.wID == arg.wID);
        if(!w) return errors.worldDNE;

        // if(w.ownerUID == arg.uid || w.ownerName == arg.uname) return errors.alreadyOwnerOfWorld; // I can't have this check bc i need it to return true if it's a success

        // if(w.publisherUID != arg.uid){ // only need to check for auth if you aren't the publisher
        //     util_warn("-------");
        //     console.log(w._perm,arg);
        //     util_warn("-------");
        //     let perm = w._perm.users.find(v=>v.uid == arg.uid || v.uname == arg.uname);
        //     if(!perm) return errors.noAuthFound;

        //     if(!perm.upload) return errors.denyAuth;
        // }
        //////

        if(w.state != "") return errors.denyTakeWorldOwnership;

        w.ownerUID = arg.uid;
        w.ownerName = arg.uname;
        await inst.save();

        io.emit("updateSearch",{
            mpID:arg.mpID,
            id:"world",
            data:{
                wID:arg.wID
            }
        });

        return new Result(true);
    });

    // ModPacks (new)
    onEv<Arg_PublishModpack,boolean>(socket,"publishModpack",async (arg)=>{
        if(!validatePath(arg.meta.id)) return errors.invalid_args;
        if(arg.meta.id == undefined) return errors.invalid_args;
        if(arg.meta.name == undefined) return errors.invalid_args;
        if(arg.meta.loader == undefined) return errors.invalid_args;
        if(arg.meta.version == undefined) return errors.invalid_args;

        let user = userCache.getBySockId(socket.id);
        if(!user) return errors.noUser;

        if(!arg.meta.desc) arg.meta.desc = "No description.";

        if(!configFile) return errors.noConfig; // no config

        if(configFile.modpacks.needPermToPublish){
            // stuff
        }

        let loc = path.join("../modpacks",arg.meta.id);
        if(await util_lstat(loc)) return errors.modpackAlreadyExists;

        let reses:boolean[] = [];
        reses.push(await util_mkdir(loc,true));
        reses.push(await util_mkdir(path.join(loc,"mods"),true));
        reses.push(await util_mkdir(path.join(loc,"resourcepacks"),true));
        reses.push(await util_mkdir(path.join(loc,"saves"),true));

        if(arg.icon) reses.push(
            await util_writeBinary(path.join(loc,"icon.png"),Buffer.from(arg.icon))
        );
        if(arg.mmcPackFile) reses.push(
            await util_writeBinary(path.join(loc,"mmc-pack.json"),Buffer.from(arg.mmcPackFile))
        );

        let newMeta:PackMetaData = {} as any;
        let ok = Object.keys(arg.meta);
        for(const k of ok){
            if(k.startsWith("_")) continue;
            (newMeta as any)[k] = (arg.meta as any)[k];
        }

        newMeta.publisherUID = user.uid;
        newMeta.publisherName = user.uname;

        reses.push(
            await util_writeJSON(path.join(loc,"meta.json"),newMeta)
        );

        if(reses.includes(false)) return errors.failedPublishModpack;
        //

        modpackCache.add(arg.meta.id,newMeta);
        
        return new Result(true);
    });
    onEv<Arg_UploadModpack,Res_UploadModpack>(socket,"uploadModpack",async (arg)=>{
        if(!validatePath(arg.mpID)) return errors.invalid_args;

        let user = userCache.getBySockId(socket.id);
        if(!user) return errors.noUser;

        let mp = (await modpackCache.get(arg.mpID)).unwrap();
        if(!mp) return errors.couldNotFindPack;

        if(mp.meta_og.publisherUID != user.uid) return errors.denyAuth;

        let mpLoc = path.join("../modpacks",arg.mpID);
        if(!await util_lstat(mpLoc)) return errors.modpackDNE;

        let files:string[] = [];

        for(const file of arg.files){
            if(!validatePath(file.sloc)) continue;

            let loc = path.join(mpLoc,"mods",file.sloc);
            let stat = await util_lstat(loc);
    
            if(stat) if(!(file.mTime > stat.mtimeMs && file.mTime > stat.birthtimeMs)) continue;

            files.push(file.sloc);
        }

        return new Result({
            files
        });
    });
    onEv<Arg_UploadModpackFile,number>(socket,"upload_modpack_file",async (arg)=>{
        if(!validatePath(arg.sloc)) return new Result(0);
        if(!validatePath(arg.mpID)) return new Result(0);

        // 
        let user = userCache.getBySockId(socket.id);
        if(!user) return errors.noUser;

        let mp = (await modpackCache.get(arg.mpID)).unwrap();
        if(!mp) return errors.couldNotFindPack;

        if(mp.meta_og.publisherUID != user.uid) return errors.denyAuth;
        // 

        let mpLoc = path.join("../modpacks",arg.mpID);
        if(!await util_lstat(mpLoc)) return new Result(0);
        
        let loc = path.join(mpLoc,"mods",arg.sloc);
        
        let res = await util_writeBinary(loc,Buffer.from(arg.buf));
        return new Result(res ? 2 : 0);
    });

    // 
    socket.on("getPack",()=>{
        
    });
});

const port = 25565;

async function getUserAuth(mpID:string,uid:string,uname?:string,call?:(data:any)=>void){
    let mp = (await modpackCache.get(mpID)).unwrap();
    if(!mp) return;

    if(!mp.meta_og._perm?.users){
        if(call) call(errors.noAuthSet);
        return;
    }

    let userAuth = mp.meta_og._perm.users.find(v=>v.uid == uid || v.uname == uname);
    if(!userAuth){
        console.log("NO AUTH: ",uid,uname);
        if(call) call(errors.noAuthFound);
        return;
    }

    return {mp,userAuth};
}

app.post("/upload_test",(req,res)=>{
    const form = new formidable.IncomingForm();
    form.parse(req,(err,fields,files)=>{
        if(err != null){
            console.log("Err uploading: ",err);
            return res.status(400).json({message:err.message});
        }

        let names = Object.keys(files);
        res.json({names});

        console.log("NAMES:",names);
    });
    
    console.log(req.body);
    res.send({
        text:"this is the res"
    });
});

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

    if(mpID.includes("..") || rpID.includes("..")){
        res.sendStatus(400);
        return;
    }

    res.sendFile(path.join(__dirname,"..","modpacks",mpID,"resourcepacks",rpID,"pack.png"));
});
app.get("/world_image",(req,res)=>{
    let mpID = req.query.mpID?.toString();
    let wID = req.query.wID?.toString();

    if(!mpID || !wID){
        res.sendStatus(400);
        return;
    }

    if(mpID.includes("..") || wID.includes("..")){
        res.sendStatus(400);
        return;
    }

    res.sendFile(path.join(__dirname,"..","modpacks",mpID,"saves",wID,"icon.png"));
});
app.get("/modpack_image",(req,res)=>{
    let mpID = req.query.mpID?.toString();

    if(!mpID){
        res.sendStatus(400);
        return;
    }

    if(mpID.includes("..")){
        res.sendStatus(400);
        return;
    }

    res.sendFile(path.join(__dirname,"..","modpacks",mpID,"icon.png"));
});

app.use(express.json({
    limit:"100mb"
}));
app.post("/world/upload_full",async (req,res)=>{
    let sid = req.headers["socket-id"];
    if(!sid){
        res.sendStatus(400);
        return;
    }
    if(typeof sid == "object") sid = sid[0];
    
    let body = req.body as {
        files:{
            buf:Uint8Array;
            path:string;
        }[];
        mpID:string;
        wID:string;
        uid:string;
        uname:string;
    };
    if(!body){
        res.sendStatus(400);
        return;
    }

    console.log("-------------------------------");
    console.log("DATA:",body);

    res.sendStatus(200);
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