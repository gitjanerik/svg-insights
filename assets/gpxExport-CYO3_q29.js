import{t as e}from"./utm-CNy0QVp-.js";function t(e){return String(e).replace(/[&<>"']/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`,"'":`&apos;`})[e])}function n(n,r,i=`SVG Insights tur`){if(!n?.points?.length)return``;let a=new Date(n.opprettet??Date.now()).toISOString(),o=t(n.navn||`Tur `+new Date(n.opprettet??Date.now()).toLocaleString(`no-NO`)),s=n.points.map(t=>{let n=e(t.x,t.y,r),i=new Date(t.t).toISOString(),a=t.accM==null?``:`\n        <hdop>${(t.accM/5).toFixed(1)}</hdop>`;return`      <trkpt lat="${n.lat.toFixed(7)}" lon="${n.lon.toFixed(7)}">
        <time>${i}</time>${a}
      </trkpt>`}).join(`
`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${t(i)}</name>
    <time>${a}</time>
  </metadata>
  <trk>
    <name>${o}</name>
    <trkseg>
${s}
    </trkseg>
  </trk>
</gpx>
`}function r(e){if(!e?.points?.length)return``;let n=new Date(e.opprettet??Date.now()).toISOString(),r=t(e.navn||`Grusrute`);return`<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="SVG Insights Ruteplanlegger"
     xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${r}</name>
    <time>${n}</time>
  </metadata>
  <rte>
    <name>${r}</name>
${e.points.map(([e,t,n])=>{let r=Number.isFinite(n)?`\n      <ele>${n.toFixed(1)}</ele>`:``;return`    <rtept lat="${t.toFixed(7)}" lon="${e.toFixed(7)}">${r}
    </rtept>`}).join(`
`)}
  </rte>
</gpx>
`}function i(e,t){let n=r(e);if(!n)return;let i=new Blob([n],{type:`application/gpx+xml`}),a=URL.createObjectURL(i),o=document.createElement(`a`);o.href=a,o.download=t??`${(e.navn||`grusrute`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(o),o.click(),document.body.removeChild(o),setTimeout(()=>URL.revokeObjectURL(a),1e3)}function a(e,t,r,i){let a=n(e,t,r);if(!a)return;let o=new Blob([a],{type:`application/gpx+xml`}),s=URL.createObjectURL(o),c=document.createElement(`a`);c.href=s,c.download=i??`${(r||`tur`).replace(/[^a-z0-9æøå]+/gi,`-`).toLowerCase()}.gpx`,document.body.appendChild(c),c.click(),document.body.removeChild(c),setTimeout(()=>URL.revokeObjectURL(s),1e3)}function o(e){let t=e?.points;if(!t||t.length<2)return 0;let n=0;for(let e=1;e<t.length;e++){let r=t[e].x-t[e-1].x,i=t[e].y-t[e-1].y;n+=Math.hypot(r,i)}return n}function s(e){let t=e?.points;return!t||t.length<2?0:t[t.length-1].t-t[0].t}export{o as i,i as n,s as r,a as t};