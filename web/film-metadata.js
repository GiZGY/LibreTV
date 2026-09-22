(() => {
  const clean = value => String(value || '').replace(/<[^>]*>/g, '').trim();
  const genres = value => (Array.isArray(value) ? value : clean(value).split(/[,，/、|]/)).map(clean).filter(v => v && !['电影','电视剧','动漫','综艺','暂无资料'].includes(v));
  function merge(item, previous = {}) {
    const rawYear = clean(item.vod_year || item.year || item.release_year);
    const year = /(?:18|19|20)\d{2}/.exec(rawYear)?.[0] || previous.year || '';
    const nextGenres = genres(item.genres || item.vod_class || item.types || item.genre);
    const known = nextGenres.length ? nextGenres : genres(previous.genres || previous.genre);
    return {year, genres:known, genre:known.join(' / ')};
  }
  function related(current, list, limit = 8) {
    const target = new Set(genres(current.genres || current.genre));
    const seen = new Set([clean(current.name).toLowerCase()]);
    return list.filter(f => f.id !== current.id && f.type === current.type).map(f => {
      const overlap = genres(f.genres || f.genre).filter(g => target.has(g)).length;
      const gap = current.year && f.year ? Math.abs(Number(current.year) - Number(f.year)) : 50;
      return {f, overlap, score:overlap * 20 + Math.max(0, 10 - gap)};
    }).filter(row => row.overlap > 0).sort((a,b)=>b.score-a.score || a.f.id.localeCompare(b.f.id)).filter(({f})=>{
      const name=clean(f.name).toLowerCase();if(seen.has(name))return false;seen.add(name);return true;
    }).slice(0,limit).map(row=>row.f);
  }
  window.FilmMetadata = {merge, related};
})();
