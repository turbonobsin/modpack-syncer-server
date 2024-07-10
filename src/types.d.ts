type PackMetaData = {
    id:string;
    name:string;
    desc:string;
    loader:string;
    version:string;
};

type Arg_SearchPacks = {
    query?:string
};
interface Res_SearchPacks{
    similar:string[];
}
interface Res_SearchPacksMeta{
    similar:PackMetaData[];
}