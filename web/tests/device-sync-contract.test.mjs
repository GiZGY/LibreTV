import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {syncRecordValue} from '../../server/device-sync.mjs';
const context=vm.createContext({window:{},URL,TextEncoder,Date,Map,Set,JSON,Number,Object,Error});
vm.runInContext(fs.readFileSync(new URL('../local-data.js',import.meta.url),'utf8'),context);
const validate=context.window.OpenStreamLocalData.validateBackup;
const f={id:'film-contract',name:'同一部剧',catalogProvider:'tmdb',catalogId:'tv:123',episodes:5000,seasons:200,year:2026};
const p={watchedAt:'2026-11-06T00:00:00.000Z',position:86400,duration:86400,episode:5000,season:200,totalEpisodes:5000,completed:true,episodeKey:'s200:e5000',completedEpisodes:['s1:e1','s200:e5000','special:新春篇','feature']};
test('all server record types round-trip through the strict portable backup schema',()=>{
 const favorite=syncRecordValue('favorite',{film:f,status:'planned'}),progress=syncRecordValue('progress',{film:f,progress:p}),skip=syncRecordValue('skip',{intro:300,outro:300}),preferences=syncRecordValue('preferences',{autoplay:true,playbackRate:1.75,motion:true,darkMode:false,mobileAutoTheme:true});
 const value=validate({format:'openstream-backup',version:1,data:{films:[progress.film],favorites:[f.id],watchlist:{[f.id]:{status:favorite.status,updatedAt:favorite.updatedAt}},history:[f.id],progress:{[f.id]:progress.progress},skip:{[f.id]:skip},preferences}});
 assert.equal(value.data.films[0].catalogId,'tv:123');assert.equal(value.data.progress[f.id].episode,5000);assert.equal(value.data.progress[f.id].completedEpisodes.length,4);assert.equal(value.data.watchlist[f.id].status,'planned');
});
test('invalid remote numeric/date/canonical identifiers are rejected before any storage write',()=>{
 for(const change of [{position:61,duration:60},{totalEpisodes:0},{watchedAt:'broken'},{episodeKey:'abc'},{completedEpisodes:['https://media.test/?token=private']},{season:201},{episode:5001},{duration:86401}])assert.throws(()=>syncRecordValue('progress',{film:f,progress:{...p,...change}}),{status:400});
 assert.throws(()=>syncRecordValue('skip',{intro:301,outro:0}),{status:400});
 assert.throws(()=>syncRecordValue('favorite',{film:{...f,name:'<b></b>'},status:'planned'}),{status:400});
});
