import{p as e}from"./demFetcher-C6MzXo21.js";function t(e,t){if(!Number.isFinite(e)||e<=0||!Number.isFinite(t))return 14;let n=Math.log2(156543.03392*Math.cos(t*Math.PI/180)/e);return Number.isFinite(n)?Math.min(16,Math.max(4,Math.round(n))):14}function n({lat:e,lon:t,zoom:n=14}){return![e,t,n].every(Number.isFinite)||Math.abs(e)>90||Math.abs(t)>180?null:`https://ut.no/kart#${Math.min(16,Math.max(4,Math.round(n)))}/${e.toFixed(5)}/${t.toFixed(5)}`}function r(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&apos;`})[e])}function i(t,n,i=`SVG Insights tur`){if(!t?.points?.length)return``;let a=new Date(t.opprettet??Date.now()).toISOString(),o=r(t.navn||`Tur `+new Date(t.opprettet??Date.now()).toLocaleString(`no-NO`)),s=t.points.map(t=>{let r=e(t.x,t.y,n),i=new Date(t.t).toISOString(),a=t.accM==null?``:`\n        <hdop>${(t.accM/5).toFixed(1)}</hdop>`;return`      <trkpt lat="${r.lat.toFixed(7)}" lon="${r.lon.toFixed(7)}">
        <time>${i}</time>${a}
      </trkpt>`}).join(`
`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${r(i)}</name>
    <time>${a}</time>
  </metadata>
  <trk>
    <name>${o}</name>
    <trkseg>
${s}
    </trkseg>
  </trk>
</gpx>
`}function a(e){if(!e?.points?.length)return``;let t=new Date(e.opprettet??Date.now()).toISOString(),n=r(e.navn||`Grusrute`);return`<?xml version="1.0" encoding="UTF-8"?>
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
`}function o(e,t){let n=a(e);if(!n)return;let r=new Blob([n],{type:`application/gpx+xml`}),i=URL.createObjectURL(r),o=document.createElement(`a`);o.href=i,o.download=t??`${(e.navn||`grusrute`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(o),o.click(),document.body.removeChild(o),setTimeout(()=>URL.revokeObjectURL(i),1e3)}function s(e,t,n,r){let a=i(e,t,n);if(!a)return;let o=new Blob([a],{type:`application/gpx+xml`}),s=URL.createObjectURL(o),c=document.createElement(`a`);c.href=s,c.download=r??`${(n||`tur`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(c),c.click(),document.body.removeChild(c),setTimeout(()=>URL.revokeObjectURL(s),1e3)}function c(e){let t=e?.points;if(!t||t.length<2)return 0;let n=0;for(let e=1;e<t.length;e++){let r=t[e].x-t[e-1].x,i=t[e].y-t[e-1].y;n+=Math.hypot(r,i)}return n}function l(e){let t=e?.points;return!t||t.length<2?0:t[t.length-1].t-t[0].t}export{n as a,c as i,o as n,t as o,l as r,s as t};