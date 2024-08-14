import path from "path";
import { errors, Result } from "./errors";
import { util_lstat, util_mkdir, util_readBinary, util_readdir, util_readJSON, util_warn, util_writeJSON } from "./util";

class ModpackCacheItem{
    constructor(id:string,meta:PackMetaData){
        this.id = id;
        this.meta_og = meta;

        if(!this.meta_og._resourcepacks) this.meta_og._resourcepacks = [];
        if(!this.meta_og._worlds) this.meta_og._worlds = [];

        let newMeta = {} as any;
        let ok = Object.keys(meta);
        for(const key of ok){
            if(key.startsWith("_")) continue;
            newMeta[key] = (meta as any)[key];
        }
        this.meta = newMeta;

        this._dirty = false;
    }
    id:string;
    meta_og:PackMetaData;
    meta:PackMetaData;

    private _dirty:boolean;
    isDirty(){
        return this._dirty;
    }
    makeDirty(){
        this._dirty = true;
    }

    async save(){
        // this.meta.mmcPackFile = undefined;
        // this.meta.instanceCfgFile = undefined;
        
        const loc = path.join("..","modpacks",this.id,"meta.json");
        await util_writeJSON(loc,this.meta_og);
    }
}

class ModpackCache{
    constructor(){
        this.cache = new Map();
    }
    cache:Map<string,ModpackCacheItem>;

    async init(){
        console.log(":: starting... Modpack Cache INIT ");
        let list = await util_readdir("../modpacks");
        let proms:Promise<any>[] = [];
        for(const id of list){
            proms.push(this.getFromHD(id));
        }
        await Promise.all(proms);
        console.log(":: finished... Modpack Cache INIT ");
    }

    add(id:string,meta:PackMetaData){
        let item = new ModpackCacheItem(id,meta);
        this.cache.set(id,item);
        return item;
    }
    delete(mpID:string){
        this.cache.delete(mpID);
    }

    async getFromHD(id:string):Promise<Result<ModpackCacheItem>>{
        const loc = "../modpacks/"+id;

        if(!id){
            return errors.couldNotFindPack;
        }

        if(!await util_lstat(loc)){
            return errors.couldNotFindPack;
        }

        let meta = await util_readJSON<PackMetaData>(loc+"/meta.json");
        if(!meta){
            return errors.failedToReadPack;
        }

        let mmcPackFile = await util_readBinary(path.join(loc,"mmc-pack.json"));
        let instanceCfg = await util_readBinary(path.join(loc,"instance.cfg"));

        if(mmcPackFile) meta.mmcPackFile = mmcPackFile;
        if(instanceCfg) meta.instanceCfgFile = instanceCfg;

        // 
        let cacheLoc = path.join("..","modpacks",id,"cache");
        await util_mkdir(cacheLoc);
        await util_mkdir(path.join(cacheLoc,"rp"));
        // 

        // console.log(".. fetched pack from HD");
        let cacheItem = modpackCache.add(id,meta);

        return new Result(cacheItem);
    }
    async get(id:string):Promise<Result<ModpackCacheItem>>{
        let item = this.cache.get(id);
        if(!item || (item ? item.isDirty() : !item)){
            return await this.getFromHD(id);
        }
        // console.log(".. got from cache");
        return new Result(item);
    }
    async getLike(id?:string,uid?:string,uname?:string){
        let similar = this.findLike(id,uid,uname);
        let metaList:ModpackCacheItem[] = [];
        for(const id of similar){
            let item = (await this.get(id)).unwrap();
            if(item) metaList.push(item);
        }
        return metaList;
    }
    findLike(query?:string,uid?:string,uname?:string){
        if(!query) query = "";
        let similar:string[] = [];
        outer: for(const [k,v] of this.cache){
            if(v.meta){
                if(v.meta.whitelist){
                    if(!v.meta.whitelist.includes(uid??"") && !v.meta.whitelist.includes(uname??"")) continue;
                }
            }
            
            let parts1 = query.trim().split(" ").map(v=>v.toLowerCase().trim());
            let parts2 = v.meta.name.trim().split(" ").map(v=>v.toLowerCase().trim());

            let matches = false;
            
            let cnt = 0;
            for(const part of parts1){
                if(parts2.includes(part)){
                    cnt++; 
                }
            }
            if(cnt == parts1.length) matches = true;

            if(!matches){ // then search by desc
                if(v.meta.desc.toLowerCase().includes(query)) matches = true;
            }
            if(!matches){ // then search by version
                if(v.meta.version.includes(query)) matches = true;
            }
            if(!matches){ // then search by loader
                if(v.meta.loader.toLowerCase().includes(query)) matches = true;
            }

            if(matches) similar.push(k);
        }
        // console.log("similar",similar,query);
        return similar;
    }
}

class User{
    constructor(data:any){
        // this.uid = data.uid;
        // this.uname = data.uname;

        let ok = Object.keys(data);
        for(const k of ok){
            if(k == "socks") continue;

            (this as any)[k] = data[k];
        }

        this.socks = new Set();
    }
    uid!:string;
    uname!:string;
    socks:Set<string>;

    async save(){
        // for now just save immidiately
        await util_writeJSON(path.join("../users",this.uid+".json"),this.serialize());
    }
    serialize(){
        return {
            uid:this.uid,
            uname:this.uname
        };
    }
}
class UserCache{
    constructor(){
        this.users = new Map();
        this.socks = new Map();
    }
    users:Map<string,User>;
    socks:Map<string,User>;

    async init(){
        await util_mkdir("../users");
        let files = await util_readdir("../users");
        for(const file of files){
            let uid = file.substring(0,file.length-".json".length);
            let data = await util_readJSON(path.join("../users",file));
            let u = new User(data);
            this.users.set(uid,u);
        }
    }

    connect(sid:string,data:Arg_Connection){
        if(!data.uid) return;
        if(!data.uname) return;
        if(!sid) return;
        
        if(!this.users.has(data.uid)){
            let u = new User({
                uid:data.uid,
                uname:data.uname
            });
            this.users.set(data.uid,u);
        }

        let u = this.users.get(data.uid);
        if(!u) return;

        u.socks.add(sid);
        this.socks.set(sid,u);

        u.save();

        return true;
    }
    disconnect(sid:string){
        if(!sid) return;

        let u = this.socks.get(sid);
        if(u){
            u.socks.delete(sid);
            this.socks.delete(sid);
        }
    }

    getByUID(uid:string){
        return this.users.get(uid);
    }
    getBySockId(sid:string){
        return this.socks.get(sid);
    }
}

export const modpackCache = new ModpackCache();
modpackCache.init();

export const userCache = new UserCache();
userCache.init();

export let configFile:ConfigFile|undefined;
util_readJSON<ConfigFile>("../data/config.json").then(v=>{
    configFile = v;
});