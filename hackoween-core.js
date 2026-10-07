/* Hack-O-Ween scoring core.
   The block between <LOGIC> markers is copied verbatim from docs/reference/hackoween-scoreboard.html
   (keep it that way: tests/hackoween.test.js checks it still matches). Everything after it is new.
   Loaded by hackoween.html and quiz.html as a plain <script>, and by the tests through require(). */
(function(root){
'use strict';
// <LOGIC>
const round1=n=>Math.round(n*10)/10;
const uid=()=>Math.random().toString(36).slice(2,8)+Date.now().toString(36).slice(-4);
const clone=o=>JSON.parse(JSON.stringify(o));
const normEmail=s=>String(s==null?'':s).trim().toLowerCase();
const normName=s=>String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

function defaultState(){
  return {
    v:1, rev:0,
    config:{
      eventName:'Hack-O-Ween', stageOverride:'',
      r1:{name:'Coding', weight:400, mode:'max', max:100, timePct:10, timeLimit:null},
      r2:{name:'Quiz', weight:400, mode:'max', max:null, timePct:0, timeLimit:null},
      bonus:{name:'Logo round', cap:200},
      quick:[20,10,-5],
      topN:10
    },
    people:{}, scores:{r1:{},r2:{}}, bonus:[], checkpoint:{}, reveal:{on:false,count:0}, last:null, log:[]
  };
}
function normalizeState(s){
  const d=defaultState(); s=s||{}; const cfg=s.config||{};
  const out=Object.assign({},d,s);
  out.config=Object.assign({},d.config,cfg,{
    r1:Object.assign({},d.config.r1,cfg.r1||{}),
    r2:Object.assign({},d.config.r2,cfg.r2||{}),
    bonus:Object.assign({},d.config.bonus,cfg.bonus||{})
  });
  out.scores={r1:Object.assign({},(s.scores&&s.scores.r1)||{}), r2:Object.assign({},(s.scores&&s.scores.r2)||{})};
  out.people=s.people||{}; out.bonus=s.bonus||[]; out.checkpoint=s.checkpoint||{};
  out.reveal=Object.assign({},d.reveal,s.reveal||{}); out.log=s.log||[];
  return out;
}

function detectDelimiter(text){
  const first=text.split(/\r?\n/).find(l=>l.trim())||'';
  const counts={',':0,';':0,'\t':0}; let q=false;
  for(const ch of first){ if(ch==='"') q=!q; else if(!q && ch in counts) counts[ch]++; }
  const best=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0];
  return counts[best]>0?best:',';
}
function parseCSV(text){
  text=String(text).replace(/^﻿/,'');
  const d=detectDelimiter(text);
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; }
      else cell+=ch;
    } else if(ch==='"' && cell===''){ q=true; }
    else if(ch===d){ row.push(cell); cell=''; }
    else if(ch==='\n'||ch==='\r'){ if(ch==='\r'&&text[i+1]==='\n') i++; row.push(cell); cell=''; rows.push(row); row=[]; }
    else cell+=ch;
  }
  if(cell!==''||row.length){ row.push(cell); rows.push(row); }
  return rows.filter(r=>r.some(c=>String(c).trim()!==''));
}
function toCSV(rows){
  return rows.map(r=>r.map(c=>{ c=String(c==null?'':c); return /[",\n\r]/.test(c)?'"'+c.replace(/"/g,'""')+'"':c; }).join(',')).join('\r\n');
}

function guessColumns(headers){
  const H=headers.map(h=>String(h==null?'':h).trim());
  const find=(pats,bad)=>{ for(const p of pats){ const i=H.findIndex(h=>p.test(h)&&!(bad&&bad.test(h))); if(i>=0) return i; } return -1; };
  const g={
    email:find([/^e-?mail([\s_]*(address|id))?$/i,/e-?mail/i]),
    name:find([/^(candidate|participant|student|full)?[\s_]*name$/i,/(candidate|participant|student|full)[\s_]*name/i,/name/i],/test|owner|team|file|user[\s_]*name/i),
    id:find([/^(participant|candidate|student|user|roll|reg(istration)?)?[\s_]*(id|no\.?|number)$/i,/^(hacker|hackerrank[\s_]*(user(name)?|handle|id)|user[\s_]*name|username|handle|login)$/i,/hacker/i],/test|question|attempt|score|marks|points|time|rank$/i),
    score:find([/^(total|final|overall)[\s_]*(score|marks|points)$/i,/^(score|marks|points)$/i,/(total|final|overall).*(score|marks|points)/i,/(score|marks|points)/i],/cutoff|max|section|skill|tag|case|percent|%|out of|possible/i),
    time:find([/time[\s_]*(taken|spent)/i,/^(duration|time)$/i,/duration|elapsed/i],/case|window|out of|start|end|submitted|zone/i),
    max:find([/^(max|maximum)[\s_]*(possible)?[\s_]*(score|marks|points)$/i,/out[\s_]*of/i,/^possible/i,/max[\s_]*(score|marks)/i],null)
  };
  if(g.name>=0 && g.name===g.email) g.name=-1;
  return g;
}
function parseScore(t){
  const s=String(t==null?'':t).trim();
  if(s===''||/^(-|—|n\/?a|na|null|none)$/i.test(s)) return {value:null,blank:true,invalid:false};
  const m=s.replace(/,/g,'').match(/^(-?\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*%?$/);
  if(!m) return {value:null,blank:false,invalid:true};
  return {value:parseFloat(m[1]),blank:false,invalid:false};
}
function parseTime(t,unit){
  const s=String(t==null?'':t).trim(); if(!s) return null;
  if(/^\d+:\d{1,2}(:\d{1,2}(\.\d+)?)?$/.test(s)){
    const p=s.split(':').map(Number);
    return p.length===3?p[0]*3600+p[1]*60+p[2]:p[0]*60+p[1];
  }
  const n=parseFloat(s.replace(/,/g,'')); if(!isFinite(n)||!/^[\d.,\s]+$/.test(s)) return null;
  return unit==='min'?n*60:n;
}
function fmtTime(sec){
  if(sec==null||!isFinite(sec)) return '';
  const t=Math.round(sec),h=Math.floor(t/3600),m=Math.floor(t%3600/60),s=t%60,p=n=>String(n).padStart(2,'0');
  return h?h+':'+p(m)+':'+p(s):m+':'+p(s);
}

function lev(a,b){
  if(a===b) return 0; const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){ const cur=[i]; for(let j=1;j<=n;j++){ cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1)); } prev=cur; }
  return prev[n];
}
function sim(a,b){ if(!a||!b) return 0; return 1-lev(a,b)/Math.max(a.length,b.length); }
function similarity(file,p){
  const a=normName(file.name), b=normName(p.name);
  const ea=normEmail(file.email).split('@')[0], eb=normEmail(p.email).split('@')[0];
  let s=0;
  if(a&&b){ s=Math.max(s,sim(a,b),sim(a.split(' ').sort().join(' '),b.split(' ').sort().join(' '))); }
  if(ea&&eb) s=Math.max(s,sim(ea,eb));
  const xa=normEmail(file.ext), xb=normEmail(p.ext);
  if(xa&&xb) s=Math.max(s,sim(xa,xb));
  if(xa&&eb) s=Math.max(s,sim(xa,eb));
  if(xa&&b) s=Math.max(s,sim(xa,b.replace(/ /g,'')));
  return s;
}
function indexPeople(people){
  const byEmail={},byExt={},byName={};
  Object.values(people).forEach(p=>{
    const e=normEmail(p.email); if(e) byEmail[e]=p.id;
    const x=normEmail(p.ext); if(x) byExt[x]=p.id;
    const n=normName(p.name); if(n) (byName[n]=byName[n]||[]).push(p.id);
  });
  return {byEmail,byExt,byName};
}
function matchRow(file,idx,people){
  const empty=!Object.keys(people).length;
  const e=normEmail(file.email),x=normEmail(file.ext),n=normName(file.name);
  if(e&&idx.byEmail[e]) return {assign:{type:'pid',pid:idx.byEmail[e]},how:'email',sugg:[]};
  if(x&&idx.byExt[x]) return {assign:{type:'pid',pid:idx.byExt[x]},how:'id',sugg:[]};
  if(n&&idx.byName[n]&&idx.byName[n].length===1) return {assign:{type:'pid',pid:idx.byName[n][0]},how:'name',sugg:[]};
  if(empty) return {assign:{type:'new'},how:'new',sugg:[]};
  const sugg=Object.values(people).map(p=>({id:p.id,s:similarity(file,p)})).filter(o=>o.s>=0.6).sort((a,b)=>b.s-a.s).slice(0,4).map(o=>o.id);
  return {assign:{type:null},how:'none',sugg};
}
function buildReviewRows(table,map,unit,state){
  const idx=indexPeople(state.people);
  return table.rows.map((r,i)=>{
    const g=k=>(map[k]!=null&&map[k]>=0)?String(r[map[k]]==null?'':r[map[k]]).trim():'';
    const file={name:g('name'),email:g('email'),ext:g('id')};
    const m=matchRow(file,idx,state.people);
    return {
      id:'r'+i, line:i+2, file, assign:m.assign, how:m.how, sugg:m.sugg, confirmed:false, changing:false, prevAssign:null,
      scoreText:g('score'), origScoreText:g('score'), score:parseScore(g('score')),
      timeText:g('time'), origTimeText:g('time'), time:parseTime(g('time'),unit),
      newName:file.name||file.ext, newEmail:file.email, ext:file.ext, rowMax:g('max')?parseFloat(g('max')):null, order:i
    };
  });
}
function analyzeRows(rows,state,maxScore){
  const out={},byPid={},byNew={};
  const newKey=r=>normEmail(r.newEmail)||('n:'+normName(r.newName));
  rows.forEach(r=>{
    if(r.assign.type==='pid') (byPid[r.assign.pid]=byPid[r.assign.pid]||[]).push(r);
    else if(r.assign.type==='new'){ const k=newKey(r); if(k!=='n:') (byNew[k]=byNew[k]||[]).push(r); }
  });
  rows.forEach(r=>{
    const iss=[]; const add=(sev,text)=>iss.push({sev,text});
    if(r.assign.type==='skip'){ out[r.id]={sev:'skip',issues:[]}; return; }
    if(r.assign.type==null) add('bad',r.how==='none'?'No participant matches this row.':'Choose who this row belongs to.');
    if(r.assign.type==='pid'){
      if(!state.people[r.assign.pid]) add('bad','That participant no longer exists.');
      if(r.how==='name'&&!r.confirmed) add('warn','Matched by name only. The email did not match, so check it is the right person.');
      const same=byPid[r.assign.pid]||[];
      if(same.length>1) add('bad','Same participant as line '+same.filter(x=>x!==r).map(x=>x.line).join(', ')+'. Skip one of them.');
    }
    if(r.assign.type==='new'){
      const same=byNew[newKey(r)]||[];
      if(same.length>1) add('bad','Duplicate of line '+same.filter(x=>x!==r).map(x=>x.line).join(', ')+'. Skip one of them.');
      if(!String(r.newName||'').trim()&&!String(r.newEmail||'').trim()) add('bad','Add a name or an email for this new participant.');
    }
    const s=r.score;
    if(s.invalid) add('bad','Score is not a number: "'+r.scoreText+'".');
    else if(s.blank) add('warn','Score is blank, so no score is recorded.');
    else if(s.value<0) add('bad','Score cannot be negative.');
    else if(maxScore!=null&&s.value>maxScore) add('bad','Score is above the maximum of '+maxScore+'.');
    if(r.timeText&&r.time==null) add('warn','Could not read the time, so it is ignored.');
    out[r.id]={sev:iss.some(x=>x.sev==='bad')?'bad':iss.some(x=>x.sev==='warn')?'warn':'ok',issues:iss};
  });
  return out;
}
function applyImport(state,key,rows,patch,missing){
  const s=clone(state);
  Object.assign(s.config[key],patch||{});
  const scores={};
  rows.forEach(r=>{
    if(r.assign.type==='skip'||r.assign.type==null) return;
    let pid;
    if(r.assign.type==='new'){
      pid='p_'+uid();
      const email=String(r.newEmail||'').trim();
      const name=String(r.newName||'').trim()||(email?email.split('@')[0]:'Unnamed');
      s.people[pid]={id:pid,name,email,ext:String(r.ext||'').trim(),dq:false};
    } else {
      pid=r.assign.pid; const p=s.people[pid]; if(!p) return;
      if(!p.email&&r.file.email) p.email=r.file.email;
      if(!p.ext&&r.file.ext) p.ext=r.file.ext;
    }
    if(r.score.value==null||r.score.invalid) return;
    scores[pid]={raw:r.score.value,time:r.time,edited:r.scoreText!==r.origScoreText||r.timeText!==r.origTimeText};
  });
  Object.keys(missing||{}).forEach(pid=>{
    if(!s.people[pid]) return;
    const sc=parseScore(missing[pid].text); if(sc.value==null) return;
    scores[pid]={raw:sc.value,time:null,edited:true};
  });
  s.scores[key]=scores;
  return s;
}

function computeBoard(state){
  const cfg=state.config;
  const active=Object.values(state.people).filter(p=>!p.dq);
  const scaler=key=>{
    const c=cfg[key], sc=state.scores[key]||{};
    const vals=active.map(p=>sc[p.id]).filter(s=>s&&s.raw!=null&&isFinite(s.raw)).map(s=>s.raw);
    const top=vals.length?Math.max.apply(null,vals):0, n=vals.length;
    return pid=>{
      const s=sc[pid];
      if(!s||s.raw==null||!isFinite(s.raw)) return {raw:null,time:null,pts:0,adj:0,edited:false};
      let f=0;
      if(s.raw>0){
        if(c.mode==='top') f=top>0?s.raw/top:0;
        else if(c.mode==='pct'){ let below=0,eq=0; vals.forEach(v=>{ if(v<s.raw) below++; else if(v===s.raw) eq++; }); f=n>0?(below+0.5*eq)/n:0; }
        else { const m=c.max>0?c.max:top; f=m>0?s.raw/m:0; }
      }
      f=Math.min(1,Math.max(0,f));
      const base=round1((c.weight||0)*f);
      let pen=0;
      if(c.timePct>0&&c.timeLimit>0&&s.time!=null&&isFinite(s.time)) pen=Math.min(c.timePct,100)/100*Math.min(1,Math.max(0,s.time/(c.timeLimit*60)));
      const pts=round1((c.weight||0)*f*(1-pen));
      return {raw:s.raw,time:s.time==null?null:s.time,pts,adj:round1(pts-base),edited:!!s.edited};
    };
  };
  const f1=scaler('r1'), f2=scaler('r2');
  const bsum={},bcount={};
  state.bonus.forEach(b=>{ if(!b.void){ bsum[b.pid]=(bsum[b.pid]||0)+b.delta; bcount[b.pid]=(bcount[b.pid]||0)+1; } });
  const cap=cfg.bonus.cap>0?cfg.bonus.cap:null;
  const rows=active.map(p=>{
    const r1=f1(p.id), r2=f2(p.id);
    const raw=bsum[p.id]||0, capped=cap!=null&&raw>cap;
    const bonus={raw:round1(raw),pts:round1(capped?cap:raw),capped,count:bcount[p.id]||0};
    return {id:p.id,name:p.name,email:p.email,r1,r2,bonus,total:round1(r1.pts+r2.pts+bonus.pts),rank:0};
  });
  const T=t=>t==null?Infinity:t;
  const cmp=(a,b)=>(b.total-a.total)||(b.r1.pts-a.r1.pts)||(T(a.r1.time)-T(b.r1.time)||0)||(b.r2.pts-a.r2.pts);
  rows.sort((a,b)=>cmp(a,b)||a.name.localeCompare(b.name));
  rows.forEach((r,i)=>{ r.rank=i===0?1:(cmp(rows[i-1],r)===0?rows[i-1].rank:i+1); });
  const base=(cfg.r1.weight||0)+(cfg.r2.weight||0);
  return {rows,base,maxTotal:(base+(cap||0))||1};
}
function rosterAdd(state,table,map){
  const s=clone(state), idx=indexPeople(s.people); let added=0,existing=0,skipped=0;
  table.rows.forEach(r=>{
    const g=k=>(map[k]!=null&&map[k]>=0)?String(r[map[k]]==null?'':r[map[k]]).trim():'';
    const file={name:g('name'),email:g('email'),ext:g('id')};
    if(!file.name&&!file.email&&!file.ext){ skipped++; return; }
    const e=normEmail(file.email), x=normEmail(file.ext), n=normName(file.name);
    let pid=(e&&idx.byEmail[e])||(x&&idx.byExt[x])||null;
    if(!pid&&!e&&!x&&n&&idx.byName[n]&&idx.byName[n].length===1) pid=idx.byName[n][0];
    if(pid){
      const p=s.people[pid];
      if(!p.email&&file.email) p.email=file.email;
      if(!p.ext&&file.ext) p.ext=file.ext;
      if((!p.name||p.name===p.ext)&&file.name) p.name=file.name;
      existing++; return;
    }
    pid='p_'+uid();
    s.people[pid]={id:pid,name:file.name||(file.email?file.email.split('@')[0]:file.ext),email:file.email,ext:file.ext,dq:false};
    if(e) idx.byEmail[e]=pid; if(x) idx.byExt[x]=pid; if(n) (idx.byName[n]=idx.byName[n]||[]).push(pid);
    added++;
  });
  return {state:s,added,existing,skipped};
}
function ranksOf(board){ const o={}; board.rows.forEach(r=>{ o[r.id]=r.rank; }); return o; }
function stageText(state){
  if(state.config.stageOverride) return state.config.stageOverride;
  if(state.bonus.some(b=>!b.void)) return state.config.bonus.name+': points are live';
  if(Object.keys(state.scores.r2).length) return 'Standings after the '+state.config.r2.name+' round';
  if(Object.keys(state.scores.r1).length) return 'Standings after the '+state.config.r1.name+' round';
  return 'Results appear here as each round is scored';
}
function parseQuick(t){ return String(t).split(/[\s,;]+/).map(Number).filter(n=>isFinite(n)&&n!==0); }

function mulberry32(a){ return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; }; }
function samplePeople(){
  const first=['Aarav','Diya','Vivaan','Ananya','Kabir','Ishita','Rohan','Meera','Arjun','Saanvi','Dev','Navya','Reyansh','Tanvi','Ishaan','Kavya','Aditya','Riya','Krish','Sneha','Harsh','Pooja','Nikhil','Aisha','Varun','Lakshmi','Siddharth','Bhavya','Karthik','Mahi','Tejas','Anika','Pranav','Nisha','Yash','Divya'];
  const last=['Sharma','Reddy','Rao','Patel','Naidu','Iyer','Gupta','Varma','Menon','Singh','Das','Kumar'];
  return first.map((f,i)=>{ const l=last[i%last.length]; return {first:f,last:l,name:f+' '+l,email:(f+'.'+l).toLowerCase()+'@example.edu',id:'HW-'+String(i+1).padStart(3,'0')}; });
}
function makeSample(kind){
  const P=samplePeople(), rnd=mulberry32(kind==='r1'?11:23);
  const hms=s=>[Math.floor(s/3600),Math.floor(s%3600/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
  if(kind==='r1'){
    const rows=[['Candidate Name','Email','Score','Time Taken','Window Exits']];
    P.forEach((p,i)=>{
      let score=String(Math.min(300,Math.round(Math.pow(rnd(),1.5)*60)*5)); const secs=1200+Math.round(rnd()*3600); let time=hms(secs);
      if(i===5){ score=''; time=''; }
      if(i===11) score='Absent';
      if(i===17) score='330';
      rows.push([p.name,p.email,score,time,String(Math.floor(rnd()*4))]);
      if(i===8) rows.push([p.name,p.email,String(Math.round(rnd()*20)*5),hms(secs+600),'1']);
    });
    return toCSV(rows);
  }
  const rows=[['participant_id','name','email','score','max_score','time_taken_sec']];
  P.forEach((p,i)=>{
    if(i===20) return;
    let score=String(Math.round(Math.pow(rnd(),0.7)*30)), name=p.name, email=p.email; const secs=300+Math.round(rnd()*900);
    if(i===3) email=email.replace('example','exmaple');
    if(i===14){ name=p.first+' '+p.last[0]+'.'; email=email.replace('example','exampel'); }
    if(i===25) score='35';
    rows.push([p.id,name,email,score,'30',String(secs)]);
  });
  rows.push(['HW-999','Guest Participant','guest@outside.org','12','30','640']);
  return toCSV(rows);
}
// </LOGIC>

/* ---------- live quiz round ----------
   The quiz round is not imported: the server returns each matched participant's live quiz score
   (quiz = {max, scores:{pid:{raw,time}}}). Hand edits in state.scores.r2 win over the live score,
   and an edit with raw:null hides that person's live score ("blank removes it"). */
function withQuiz(state,quiz){
  const s=clone(state), live=(quiz&&quiz.scores)||{}, r2={};
  Object.keys(live).forEach(pid=>{ if(s.people[pid]&&live[pid]&&live[pid].raw!=null) r2[pid]={raw:live[pid].raw,time:live[pid].time==null?null:live[pid].time,edited:false}; });
  Object.keys(s.scores.r2).forEach(pid=>{ const o=s.scores.r2[pid]; if(o&&o.raw==null) delete r2[pid]; else r2[pid]=o; });
  s.scores.r2=r2;
  if(!(s.config.r2.max>0)&&quiz&&quiz.max>0) s.config.r2.max=quiz.max;
  return s;
}

/* the review screen's Commit button: every row reviewed, no red rows, at least one row to import */
function canCommit(rows,state,maxScore){
  const an=analyzeRows(rows,state,maxScore), sev=rows.map(r=>an[r.id].sev);
  return !sev.includes('bad')&&sev.some(v=>v!=='skip');
}

const api={round1,uid,clone,normEmail,normName,defaultState,normalizeState,detectDelimiter,parseCSV,toCSV,guessColumns,parseScore,parseTime,fmtTime,
  lev,sim,similarity,indexPeople,matchRow,buildReviewRows,analyzeRows,applyImport,computeBoard,rosterAdd,ranksOf,stageText,parseQuick,withQuiz,canCommit};
if(typeof module==='object'&&module.exports) module.exports=api; else root.HW=api;
})(typeof window!=='undefined'?window:this);
