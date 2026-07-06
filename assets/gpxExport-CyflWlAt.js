import{L as e,V as t}from"./createMapFlow-CgHy-Tou.js";function n(e,t){if(!Number.isFinite(e)||e<=0||!Number.isFinite(t))return 14;let n=Math.log2(156543.03392*Math.cos(t*Math.PI/180)/e);return Number.isFinite(n)?Math.min(16,Math.max(4,Math.round(n))):14}function r({lat:e,lon:t,zoom:n=14}){return![e,t,n].every(Number.isFinite)||Math.abs(e)>90||Math.abs(t)>180?null:`https://ut.no/kart#${Math.min(16,Math.max(4,Math.round(n)))}/${e.toFixed(5)}/${t.toFixed(5)}`}function i(e,t){return`https://www.google.com/maps?q=${e.toFixed(6)},${t.toFixed(6)}`}function a(e,t){return`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${e.toFixed(6)},${t.toFixed(6)}`}function o({lat:e,lon:n,zoom:r=14}){if(![e,n,r].every(Number.isFinite)||Math.abs(e)>90||Math.abs(n)>180)return null;let i=Math.min(16,Math.max(3,Math.round(r))),{e:a,n:o}=t(e,n);return`https://vegkart.atlas.vegvesen.no/#kartlag:geodata/@${Math.round(a)},${Math.round(o)},${i}`}function s(e){return e?`https://www.kulturminnesok.no/kart/?id=${encodeURIComponent(e)}`:null}function c(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&apos;`})[e])}function l(t,n,r=`SVG Insights tur`){if(!t?.points?.length)return``;let i=new Date(t.opprettet??Date.now()).toISOString(),a=c(t.navn||`Tur `+new Date(t.opprettet??Date.now()).toLocaleString(`no-NO`)),o=t.points.map(t=>{let r=e(t.x,t.y,n),i=new Date(t.t).toISOString(),a=t.accM==null?``:`\n        <hdop>${(t.accM/5).toFixed(1)}</hdop>`;return`      <trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}">
        <time>${i}</time>${a}
      </trkpt>`}).join(`
`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${c(r)}</name>
    <time>${i}</time>
  </metadata>
  <trk>
    <name>${a}</name>
    <trkseg>
${o}
    </trkseg>
  </trk>
</gpx>
`}function u(e){if(!e?.points?.length)return``;let t=new Date(e.opprettet??Date.now()).toISOString(),n=c(e.navn||`Grusrute`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights Ruteplanlegger"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${n}</name>
    <time>${t}</time>
  </metadata>
  <rte>
    <name>${n}</name>
${e.points.map(([e,t,n])=>{let r=Number.isFinite(n)?`\n      <ele>${n.toFixed(1)}</ele>`:``;return`    <rtept lat="${t.toFixed(7)}" lon="${e.toFixed(7)}">${r}
    </rtept>`}).join(`
`)}
  </rte>
</gpx>
`}function d(e,t){let n=u(e);if(!n)return;let r=new Blob([n],{type:`application/gpx+xml`}),i=URL.createObjectURL(r),a=document.createElement(`a`);a.href=i,a.download=t??`${(e.navn||`grusrute`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(a),a.click(),document.body.removeChild(a),setTimeout(()=>URL.revokeObjectURL(i),1e3)}function f(e,t,n,r){let i=l(e,t,n);if(!i)return;let a=new Blob([i],{type:`application/gpx+xml`}),o=URL.createObjectURL(a),s=document.createElement(`a`);s.href=o,s.download=r??`${(n||`tur`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(s),s.click(),document.body.removeChild(s),setTimeout(()=>URL.revokeObjectURL(o),1e3)}function p(e){let t=e?.points;if(!t||t.length<2)return 0;let n=0;for(let e=1;e<t.length;e++){let r=t[e].x-t[e-1].x,i=t[e].y-t[e-1].y;n+=Math.hypot(r,i)}return n}function m(e){let t=e?.points;return!t||t.length<2?0:t[t.length-1].t-t[0].t}export{s as a,a as c,p as i,r as l,d as n,o,m as r,i as s,f as t,n as u};