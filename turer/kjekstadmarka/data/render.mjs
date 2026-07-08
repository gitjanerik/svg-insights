import fs from 'fs';
const D=JSON.parse(fs.readFileSync('mapdata.json','utf8'));

// ---- view bbox: pad around routes ----
const allRoutePts=[...D.route1.coords,...D.route2.coords,[D.start.lon,D.start.lat]];
let minLon=1e9,maxLon=-1e9,minLat=1e9,maxLat=-1e9;
for(const[lo,la]of allRoutePts){minLon=Math.min(minLon,lo);maxLon=Math.max(maxLon,lo);minLat=Math.min(minLat,la);maxLat=Math.max(maxLat,la);}
const padLat=0.004,padLon=0.019;
minLat-=padLat;maxLat+=padLat;minLon-=padLon;maxLon+=padLon;
const lat0=(minLat+maxLat)/2, mPerLat=110540, mPerLon=111320*Math.cos(lat0*Math.PI/180);

// ---- projection to pixel ----
const W=1580, MARG=64;
const worldW=(maxLon-minLon)*mPerLon, worldH=(maxLat-minLat)*mPerLat;
const scale=(W-2*MARG)/worldW;             // px per meter
const H=Math.round(worldH*scale+2*MARG);
const X=lo=>MARG+(lo-minLon)*mPerLon*scale;
const Y=la=>MARG+(maxLat-la)*mPerLat*scale;
const inView=(lo,la)=>lo>=minLon&&lo<=maxLon&&la>=minLat&&la<=maxLat;
const f=n=>(+n).toFixed(1);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const path=coords=>coords.map((c,i)=>`${i?'L':'M'}${f(X(c[0]))} ${f(Y(c[1]))}`).join(' ');

let s=[];
s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Georgia,'Times New Roman',serif">`);

// ---- defs ----
s.push(`<defs>
  <radialGradient id="paper" cx="50%" cy="42%" r="75%">
    <stop offset="0%" stop-color="#f3e7c9"/>
    <stop offset="62%" stop-color="#ecdcb8"/>
    <stop offset="100%" stop-color="#d8c096"/>
  </radialGradient>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n"/>
    <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.32  0 0 0 0 0.22  0 0 0 0 0.10  0 0 0 0.05 0"/>
    <feComposite operator="over" in2="SourceGraphic"/></filter>
  <filter id="soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="0.5"/></filter>
  <radialGradient id="vig" cx="50%" cy="50%" r="72%">
    <stop offset="55%" stop-color="#000000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#4a3413" stop-opacity="0.28"/></radialGradient>
  <marker id="arrow1" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto">
    <path d="M1 1 L8 4.5 L1 8 Z" fill="#7a3f16"/></marker>
  <marker id="arrow2" markerWidth="9" markerHeight="9" refX="4.5" refY="4.5" orient="auto">
    <path d="M1 1 L8 4.5 L1 8 Z" fill="#2f5d4f"/></marker>
</defs>`);

// paper
s.push(`<rect width="${W}" height="${H}" fill="url(#paper)"/>`);
// thin neat border frame
s.push(`<rect x="14" y="14" width="${W-28}" height="${H-28}" fill="none" stroke="#7a5a2c" stroke-width="2.5"/>`);
s.push(`<rect x="21" y="21" width="${W-42}" height="${H-42}" fill="none" stroke="#7a5a2c" stroke-width="0.8"/>`);

// ---- water ----
s.push(`<g stroke="#8a7245" stroke-width="1" >`);
for(const lk of D.lakes){
  const c=lk.coords.filter(p=>true);
  // render even if partly outside; clip via viewBox
  s.push(`<path d="${path(lk.coords)} Z" fill="#c9d6cf" fill-opacity="0.85"/>`);
}
s.push(`</g>`);
// streams
s.push(`<g fill="none" stroke="#9fb1a6" stroke-width="0.8" stroke-opacity="0.7">`);
for(const st of D.streams){ if(st.some(p=>inView(p[0],p[1]))) s.push(`<path d="${path(st)}"/>`); }
s.push(`</g>`);

// ---- faint trail/context network: skip (keep clean) ----

// ---- charcoal piles: ALL as faint rings (density story) ----
s.push(`<g stroke="#6b4a24" stroke-width="0.8" fill="none" stroke-opacity="0.55">`);
let cShown=0;
for(const cp of D.feats.charcoal){ if(!inView(cp.lon,cp.lat))continue; cShown++;
  const x=X(cp.lon),y=Y(cp.lat);
  s.push(`<circle cx="${f(x)}" cy="${f(y)}" r="2.6"/><circle cx="${f(x)}" cy="${f(y)}" r="0.7" fill="#6b4a24"/>`);
}
s.push(`</g>`);

// ---- routes ----
function metLen(a,b){const dx=(b[0]-a[0])*mPerLon,dy=(b[1]-a[1])*mPerLat;return Math.hypot(dx,dy);}
function pxOffset(coords,dpx){
  const p=coords.map(c=>[X(c[0]),Y(c[1])]);const out=[];
  for(let i=0;i<p.length;i++){
    const a=p[Math.max(0,i-1)],b=p[Math.min(p.length-1,i+1)];
    let tx=b[0]-a[0],ty=b[1]-a[1];const L=Math.hypot(tx,ty)||1;tx/=L;ty/=L;
    out.push([p[i][0]-ty*dpx,p[i][1]+tx*dpx]);
  }
  return out;
}
const pxPath=pts=>pts.map((c,i)=>`${i?'L':'M'}${f(c[0])} ${f(c[1])}`).join(' ');
function drawRoute(r,color,dash,dpx){
  const pts=pxOffset(r.coords,dpx);
  s.push(`<path d="${pxPath(pts)}" fill="none" stroke="#f4ead0" stroke-opacity="0.85" stroke-width="6.5" stroke-linejoin="round" stroke-linecap="round"/>`);
  s.push(`<path d="${pxPath(pts)}" fill="none" stroke="${color}" stroke-width="3.2" stroke-dasharray="${dash}" stroke-linejoin="round" stroke-linecap="round"/>`);
  const cum=[0];for(let i=1;i<r.coords.length;i++)cum.push(cum[i-1]+metLen(r.coords[i-1],r.coords[i]));
  const tot=cum[cum.length-1];
  for(const fr of [0.2,0.45,0.7,0.9]){
    const target=fr*tot;let i=1;while(i<cum.length&&cum[i]<target)i++;if(i>=pts.length)i=pts.length-1;
    const a=pts[i-1],b=pts[i];const ang=Math.atan2(b[1]-a[1],b[0]-a[0])*180/Math.PI;
    s.push(`<path d="M-5 -4 L6 0 L-5 4 Z" fill="${color}" transform="translate(${f(b[0])} ${f(b[1])}) rotate(${f(ang)})"/>`);
  }
}
drawRoute(D.route1,"#8a3f12","1 0",3.0);    // solid warm brown, offset one side
drawRoute(D.route2,"#2f5d4f","10 6",-3.0);  // dashed teal-sepia, other side

// ---- markers helpers ----
const labels=[]; // {x,y,text,cls,dx,dy}
function label(x,y,text,dx=6,dy=3,size=12,weight='normal',fill='#3d2812'){
  labels.push({x,y,text,dx,dy,size,weight,fill});
}
// peaks (named, in view)
s.push(`<g>`);
const peakSeen=new Set();
for(const p of D.feats.peak){ if(!inView(p.lon,p.lat)||!p.name)continue;
  const x=X(p.lon),y=Y(p.lat);
  s.push(`<path d="M${f(x)} ${f(y-6)} L${f(x+5.2)} ${f(y+4)} L${f(x-5.2)} ${f(y+4)} Z" fill="none" stroke="#5a3a17" stroke-width="1.4"/>`);
  label(x,y-8,`${p.name}${p.ele?' '+p.ele:''}`,0,-3,11,'italic','#4a2f12'); peakSeen.add(p.name);
}
// crofts/shieling near routes (union)
const plassNames=new Set([...D.route1.near.shieling,...D.route1.near.croft,...D.route2.near.shieling,...D.route2.near.croft].map(x=>x.name));
for(const list of [D.feats.shieling,D.feats.croft]){
  for(const c of list){ if(!inView(c.lon,c.lat))continue;
    const x=X(c.lon),y=Y(c.lat);
    s.push(`<path d="M${f(x-4)} ${f(y+3)} v-4 l4 -3 l4 3 v4 Z" fill="#e7d3a8" stroke="#5a3a17" stroke-width="1.1"/>`);
    if(c.name&&plassNames.has(c.name)) label(x,y,c.name,6,3,10.5,'normal','#4a2f12');
  }
}
// works (Dikemark Jernverk) - big anvil-ish square
for(const w of D.feats.works){ if(!inView(w.lon,w.lat))continue;
  const x=X(w.lon),y=Y(w.lat);
  s.push(`<g><rect x="${f(x-7)}" y="${f(y-7)}" width="14" height="14" rx="2" fill="#7a3f16" stroke="#3d2812" stroke-width="1.5"/>
   <path d="M${f(x-4)} ${f(y+1)} h8 M${f(x-2.5)} ${f(y+1)} l1.5 -4 h2 l1.5 4" stroke="#f3e7c9" stroke-width="1.4" fill="none"/></g>`);
  label(x,y+9,w.name,0,12,13,'bold','#5a2708');
}
// hut Småvannsbu
for(const h of D.feats.hut){ if(!inView(h.lon,h.lat)||!h.name)continue;
  const x=X(h.lon),y=Y(h.lat);
  s.push(`<path d="M${f(x-6)} ${f(y+5)} L${f(x)} ${f(y-6)} L${f(x+6)} ${f(y+5)} Z" fill="#b5542a" stroke="#3d2812" stroke-width="1.4"/>`);
  label(x,y+6,h.name,0,12,11.5,'bold','#5a2708');
}
s.push(`</g>`);

// ---- START at Verkensvannet ----
{ const x=X(D.start.lon),y=Y(D.start.lat);
  s.push(`<g><circle cx="${f(x)}" cy="${f(y)}" r="9" fill="#f3e7c9" stroke="#8a3f12" stroke-width="2.5"/>
   <circle cx="${f(x)}" cy="${f(y)}" r="3.4" fill="#8a3f12"/></g>`);
  label(x,y,'START',12,-6,13,'bold','#8a3f12');
}

// ---- labels (drawn last, with halo) ----
s.push(`<g>`);
for(const L of labels){
  const tx=f(X? L.x:L.x); // already px
}
for(const L of labels){
  const anchor = L.dx<0?'end':(L.dx===0?'middle':'start');
  s.push(`<text x="${f(L.x+L.dx)}" y="${f(L.y+L.dy)}" text-anchor="${anchor}" font-size="${L.size}" font-style="${L.weight==='italic'?'italic':'normal'}" font-weight="${L.weight==='bold'?'bold':'normal'}" fill="${L.fill}" stroke="#f1e5c7" stroke-width="2.6" paint-order="stroke" stroke-linejoin="round">${esc(L.text)}</text>`);
}
s.push(`</g>`);

// ---- vignette ----
s.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="url(#vig)"/>`);

// ---- scale bar ----
const barM=1000, barPx=barM*scale;
const bx=MARG+20, by=H-MARG-8;
s.push(`<g stroke="#3d2812" stroke-width="1.4" fill="#3d2812" font-size="11">
  <line x1="${f(bx)}" y1="${f(by)}" x2="${f(bx+barPx)}" y2="${f(by)}"/>
  <line x1="${f(bx)}" y1="${f(by-5)}" x2="${f(bx)}" y2="${f(by+5)}"/>
  <line x1="${f(bx+barPx/2)}" y1="${f(by-4)}" x2="${f(bx+barPx/2)}" y2="${f(by+4)}"/>
  <line x1="${f(bx+barPx)}" y1="${f(by-5)}" x2="${f(bx+barPx)}" y2="${f(by+5)}"/>
  <rect x="${f(bx)}" y="${f(by)}" width="${f(barPx/2)}" height="4" stroke="none"/>
  <text x="${f(bx)}" y="${f(by-9)}" stroke="none">0</text>
  <text x="${f(bx+barPx)}" y="${f(by-9)}" text-anchor="middle" stroke="none">1 km</text>
</g>`);

// ---- compass rose (top-right) ----
{ const cx=W-MARG-38, cy=MARG+46, r=26;
  s.push(`<g stroke="#3d2812" fill="#3d2812">
   <circle cx="${cx}" cy="${cy}" r="${r}" fill="#f1e5c7" fill-opacity="0.6" stroke-width="1.2"/>
   <path d="M${cx} ${cy-r-4} L${cx+6} ${cy} L${cx} ${cy+r+4} L${cx-6} ${cy} Z" fill="#7a3f16" stroke="#3d2812" stroke-width="0.8"/>
   <path d="M${cx} ${cy-r-4} L${cx+6} ${cy} L${cx-6} ${cy} Z" fill="#3d2812"/>
   <text x="${cx}" y="${cy-r-8}" text-anchor="middle" font-size="12" font-weight="bold" stroke="none">N</text></g>`);
}

// ---- title cartouche (top-left) ----
s.push(`<g>
  <rect x="${MARG+8}" y="${MARG+8}" width="356" height="86" rx="4" fill="#f1e5c7" fill-opacity="0.82" stroke="#7a5a2c" stroke-width="1.4"/>
  <text x="${MARG+26}" y="${MARG+42}" font-size="27" font-weight="bold" letter-spacing="2" fill="#4a2708">KJEKSTADMARKA</text>
  <text x="${MARG+27}" y="${MARG+63}" font-size="13.5" font-style="italic" fill="#5a3a17">To turforslag fra Verkensvannet · kulturminnetur</text>
  <text x="${MARG+27}" y="${MARG+81}" font-size="11.5" fill="#6b4a24">Dikemark · Asker · gamle kullmiler til Dikemarkverket</text>
</g>`);

// ---- legend (bottom-right) ----
const lx=W-MARG-262, ly=H-MARG-178;
s.push(`<g font-size="12" fill="#3d2812">
  <rect x="${lx}" y="${ly}" width="250" height="172" rx="4" fill="#f1e5c7" fill-opacity="0.85" stroke="#7a5a2c" stroke-width="1.3"/>
  <text x="${lx+14}" y="${ly+22}" font-size="13.5" font-weight="bold">Tegnforklaring</text>
  <line x1="${lx+14}" y1="${ly+40}" x2="${lx+44}" y2="${ly+40}" stroke="#8a3f12" stroke-width="3.4"/>
  <text x="${lx+52}" y="${ly+44}">Tur 1 · Kullmilerunden ${D.route1.km} km</text>
  <line x1="${lx+14}" y1="${ly+62}" x2="${lx+44}" y2="${ly+62}" stroke="#2f5d4f" stroke-width="3.4" stroke-dasharray="9 6"/>
  <text x="${lx+52}" y="${ly+66}">Tur 2 · Vestrunden ${D.route2.km} km</text>
  <circle cx="${lx+29}" cy="${ly+84}" r="2.6" fill="none" stroke="#6b4a24" stroke-width="0.8"/><circle cx="${lx+29}" cy="${ly+84}" r="0.7" fill="#6b4a24"/>
  <text x="${lx+52}" y="${ly+88}">Kullmile (${cShown} i kartet)</text>
  <rect x="${lx+22}" y="${ly+100}" width="12" height="12" rx="2" fill="#7a3f16" stroke="#3d2812" stroke-width="1"/>
  <text x="${lx+52}" y="${ly+110}">Jernverk</text>
  <path d="M${lx+23} ${ly+130} l6 -9 l6 9 Z" fill="#b5542a" stroke="#3d2812" stroke-width="1"/>
  <text x="${lx+52}" y="${ly+132}">DNT-koie</text>
  <path d="M${lx+24} ${ly+126} v-4 l5 -3 l5 3 v4 Z" fill="#e7d3a8" stroke="#5a3a17" stroke-width="1" transform="translate(96,0)"/>
  <text x="${lx+150}" y="${ly+132}">Plass/seter</text>
</g>`);

s.push(`</svg>`);
fs.writeFileSync('kjekstadmarka-tur.svg',s.join('\n'));
console.log('wrote kjekstadmarka-tur.svg  ',W,'x',H,' charcoal shown:',cShown);
