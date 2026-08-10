const g=".proposal-document.pa-proposal-doc--gefen .proposal-document-content",f=`${g} .pa-org-intro`,u="gefen-proposal-print-layout-v4",E=12,h=3;function p(o,e,i){var r;(r=o==null?void 0:o.style)==null||r.setProperty(e,i,"important")}function v(){if(typeof document>"u"||document.getElementById(u))return;const o=document.createElement("style");o.id=u,o.textContent=`
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content {
      display: flex !important;
      flex-direction: column !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-date {
      order: 0 !important;
      margin: 0 0 1mm !important;
      line-height: 1.1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-title {
      order: 1 !important;
      margin: 0 0 1.4mm !important;
      line-height: 1.08 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-org-intro {
      order: 2 !important;
      margin: 0 0 1.2mm !important;
      padding: 0 3mm !important;
      box-sizing: border-box !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > :not(.pa-doc-date):not(.pa-doc-title):not(.pa-org-intro) {
      order: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro > p {
      margin: 0 0 1mm !important;
      line-height: 1.22 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list {
      display: grid !important;
      grid-template-columns: repeat(4, minmax(30mm, max-content)) !important;
      grid-template-rows: repeat(3, auto) !important;
      column-gap: 4.5mm !important;
      row-gap: .7mm !important;
      justify-content: center !important;
      align-items: start !important;
      width: max-content !important;
      max-width: 100% !important;
      margin: .8mm auto 1mm !important;
      padding-inline-start: 4mm !important;
      list-style-position: outside !important;
      text-align: right !important;
      direction: rtl !important;
      box-sizing: border-box !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li {
      margin: 0 !important;
      padding: 0 !important;
      white-space: nowrap !important;
      break-inside: avoid !important;
      line-height: 1.15 !important;
      font-weight: 700 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(1),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(4),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(7),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(10) {
      grid-row: 1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(2),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(5),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(8),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(11) {
      grid-row: 2 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(3),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(6),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(9),
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(12) {
      grid-row: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(-n+3) {
      grid-column: 1 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+4):nth-child(-n+6) {
      grid-column: 2 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+7):nth-child(-n+9) {
      grid-column: 3 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-org-intro .pa-proposal-list > li:nth-child(n+10):nth-child(-n+12) {
      grid-column: 4 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section {
      margin: 1.6mm 0 !important;
      padding: 0 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-heading {
      margin: 0 0 .8mm !important;
      line-height: 1.12 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section p,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-text > p,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section-body > p {
      margin: 0 0 1mm !important;
      line-height: 1.23 !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section ul,
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section ol {
      margin: .6mm 0 1.2mm !important;
      padding-inline-start: 5mm !important;
    }
    .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .pa-section li {
      margin: 0 0 .45mm !important;
      line-height: 1.2 !important;
    }
    @media print {
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-title {
        width: 100% !important;
        text-align: center !important;
      }
      .pa-proposal-doc--gefen:not(.pa-gefen-approval-document) .proposal-document-content > .pa-doc-date {
        width: 100% !important;
        text-align: left !important;
      }
    }
  `,document.head.appendChild(o)}function b(o=document){var i,r;const e=[];(i=o==null?void 0:o.matches)!=null&&i.call(o,g)&&e.push(o),(r=o==null?void 0:o.querySelectorAll)==null||r.call(o,g).forEach(a=>e.push(a)),e.forEach(a=>{const t=a.querySelector(":scope > .pa-doc-title"),l=a.querySelector(":scope > .pa-doc-date:not(.pa-gefen-approval-date)");!t||!l||t.previousElementSibling===l||a.insertBefore(l,t)})}function w(o=document){var i,r;const e=[];(i=o==null?void 0:o.matches)!=null&&i.call(o,f)&&e.push(o),(r=o==null?void 0:o.querySelectorAll)==null||r.call(o,f).forEach(a=>e.push(a)),e.forEach(a=>{const t=a.querySelector(":scope > .pa-proposal-list"),l=Array.from((t==null?void 0:t.children)||[]).filter(n=>(n==null?void 0:n.tagName)==="LI");if(!t||l.length!==E)return;p(a,"margin-top","0"),p(a,"margin-bottom","4px"),p(a,"padding-top","0"),p(a,"padding-bottom","0"),a.querySelectorAll(":scope > p").forEach((n,d)=>{p(n,"margin-top","0"),p(n,"margin-bottom",d===0?"4px":"2px"),p(n,"line-height","1.22")}),t.dataset.gefenIntroColumns="4x3",p(t,"display","grid"),p(t,"grid-template-columns","repeat(4, minmax(122px, max-content))"),p(t,"grid-template-rows","repeat(3, auto)"),p(t,"column-gap","20px"),p(t,"row-gap","2px"),p(t,"justify-content","center"),p(t,"align-items","start"),p(t,"width","max-content"),p(t,"max-width","100%"),p(t,"margin","4px auto 5px"),p(t,"padding-inline-start","16px"),p(t,"list-style-position","outside"),p(t,"text-align","right"),p(t,"direction","rtl"),p(t,"box-sizing","border-box"),l.forEach((n,d)=>{const x=Math.floor(d/h)+1,y=d%h+1;p(n,"grid-column",String(x)),p(n,"grid-row",String(y)),p(n,"margin","0"),p(n,"padding","0"),p(n,"white-space","nowrap"),p(n,"break-inside","avoid"),p(n,"line-height","1.15"),p(n,"font-weight","700")});const c=a.nextElementSibling;if(c){p(c,"margin-top","4px");const n=c.matches("p")?c:c.querySelector(":scope > p, :scope > .pa-section-body > p, :scope > .pa-section-text > p");n&&(p(n,"margin-top","0"),p(n,"margin-bottom","5px"),p(n,"line-height","1.23"))}})}function S(o=document){v(),b(o),w(o)}let m=!1;function s(){m||(m=!0,queueMicrotask(()=>{m=!1,S()}))}typeof document<"u"&&(v(),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",s,{once:!0}):s(),new MutationObserver(s).observe(document.documentElement,{childList:!0,subtree:!0}));export{S as applyGefenProposalLayout,w as layoutGefenIntroSkills,b as moveGefenProposalDateAboveTitle};
