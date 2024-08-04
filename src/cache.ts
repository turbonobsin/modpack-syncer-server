import path from "path";
import { errors, Result } from "./errors";
import { util_lstat, util_mkdir, util_readdir, util_readJSON, util_warn, util_writeJSON } from "./util";

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
    async getLike(id?:string){
        let similar = this.findLike(id);
        let metaList:ModpackCacheItem[] = [];
        for(const id of similar){
            let item = (await this.get(id)).unwrap();
            if(item) metaList.push(item);
        }
        return metaList;
    }
    findLike(query?:string){
        if(!query) query = "";
        let similar:string[] = [];
        outer: for(const [k,v] of this.cache){
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

export const modpackCache = new ModpackCache();
modpackCache.init();