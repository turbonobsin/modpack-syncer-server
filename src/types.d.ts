interface PackMetaData{
    id:string;
    name:string;
    desc:string;
    loader:string;
    version:string;

    update:number;

    _perm:{
        users:UserAuth[];
    };
    _resourcepacks:RPMeta[];
    _worlds:SWorldMeta[];
}
interface SWorldMeta{
    wID:string;
    icon:string;
    ownerUID:string;
    ownerName:string;
    _perm:{
        users:{
            uname?:string;
            uid?:string;
            upload?:boolean;
        }[]
    }
}
interface WorldMeta{
    wID:string;
    icon:string;
    ownerUID:string;
    ownerName:string;
}
interface Arg_GetWorldMeta{
    mpID:string;
    wID:string;
}
interface Res_GetWorldMeta{
    isPublished:boolean;
    data?:WorldMeta;
}
// 

interface PackMetaData_Client extends PackMetaData{
    resourcepacks:{
        rpID:string;
    }[];
}

interface RPMeta{
    update:number;
    ownerUID:string;
    rpID:string;
    _perm:{
        users:RPUserAuth[];
    }
}

interface Base_UserAuth{
    uid?:string;
    uname?:string;
}
interface RPUserAuth extends Base_UserAuth{
    upload?:boolean;
}

interface UserAuth extends Base_UserAuth{
    uploadRP?:boolean;
}

type Arg_SearchPacks = {
    query?:string
};
interface Res_SearchPacks{
    similar:string[];
}
interface Res_SearchPacksMeta{
    similar:PackMetaData[];
}

// sync
interface Arg_GetModUpdates{
    id:string;
    currentMods:string[];
    currentIndexes:string[];
    ignoreMods:string[];
}
interface Res_GetModUpdates{
    mods:{
        add:string[],
        remove:string[]
    },
    indexes:{
        add:string[],
        remove:string[]
    }
}

// resource packs
interface Arg_UploadRP{
    iid:string;
    uid:string;
    uname:string;
    mpID:string;
    name:string;
}
interface Res_UploadRP{
    res:number;
    update:number;
}
interface Arg_UploadRPFile{
    path:string;
    buf:Uint8Array;
    mpID:string;
    rpName:string;

    uid?:string;
    uname?:string;

    at:number;
    mt:number;
    bt:number;
}
interface Arg_DownloadRPFile{
    path:string;
    mpID:string;
    rpName:string;

    // upload:number;
    // download:number;
    // modified:number;
}
interface Arg_DownloadRP{
    iid:string;
    mpID:string;
    rpID:string;
    lastDownloaded:number;
    data:Record<string,RPCache>;
    force?:boolean;
}
interface ModifiedFile{
    n:string; // just the name of the file
    l:string; // relative path/location
    // mt:number; // last modified (or time created if that's newer)
    mt:number; // modify time
    bt:number; // birth time (time created)
    at:number;
}
interface ModifiedFileData{
    buf:Uint8Array;
    mt:number;
    at:number;
}
interface Res_DownloadRP{
    add:ModifiedFile[];
    remove:ModifiedFile[];
    update:number;
}
interface RPCache{
    upload:number;
    download:number;
    modified:number;
}

// 
interface Arg_GetRPs{
    mpID:string;
    existing:string[];
}
interface RP_Data{
    name:string;
    data?:{ // data will be defined only if the Resource Pack has been unpacked into a folder (because I can't efficiently read the data otherwise)
        icon?:string;
        meta?:RP_MCMeta;
        sync?:RP_Sync;
    }
}
interface RP_Sync{
    rpID:string;
}
interface Res_GetRPs{
    list:RP_Data[];
}
interface RP_MCMeta{
    pack:{
        pack_format:number;
        description:string;
    }
}

interface Arg_GetRPVersions{
    mpID:string;
    current:{
        rpID:string;
        update:number;
    }[];
}
interface Res_GetRPVersions{
    versions:{
        rpID:string;
        update:number;
    }[];
}