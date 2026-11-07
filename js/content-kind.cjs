(()=>{
// The title of a feature is not a content category. Require a trailer label, not a keyword hit.
const clean=value=>String(value||'').normalize('NFKC').replace(/<[^>]*>/g,'').trim();
const tag=/^(?:预告片?|預告片?|先导片|先導片|trailer|teaser|preview)s?$/i;
const titleLabel=/(?:[【\[(]\s*(?:(?:正式|官方|先导|先導|定档|定檔|终极|終極)?[预預]告片?|(?:official\s+)?(?:teaser|trailer))\s*[】\])]|[预預]告片|(?:^|[\s:|—-])official\s+(?:teaser|trailer))(?:\s*\d+)?$/i;
const trailerItem=item=>[item.type_name,item.type,item.vod_class,item.genre,item.vod_remarks,item.remarks,item.media_type].some(v=>clean(v).split(/[,，、/|]/).some(part=>tag.test(part.trim())))||
 [item.vod_name,item.title,item.name].some(v=>titleLabel.test(clean(v)));
const trailerEpisode=value=>tag.test(clean(value))||titleLabel.test(clean(value))||/(?:第[\d一二三四五六七八九十百]+[集期话話]|s\d+e\d+|ep\s*\d+)\s*[-:·]?\s*[预預]告$/i.test(clean(value));
const trailerRecord=record=>/^(?:special|label):/.test(record?.episodeKey||'')&&trailerEpisode(record.episodeKey.replace(/^[^:]+:/,''));
const policy={trailerItem,trailerEpisode,trailerRecord};
if(typeof module!=='undefined'&&module.exports)module.exports=policy;
if(typeof window!=='undefined')window.OpenStreamContent=policy;
})();
