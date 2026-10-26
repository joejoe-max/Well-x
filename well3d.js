'use strict';
/* WELL - X 3D module (Three.js r147, local vendor/). Illustrative geometry and flow only: not a reservoir simulator. */
const Well3D=(()=>{
const T=THREE,box=$('#cvw'),lbl=$('#lbls'),inf=$('#cinfo'),V3=(x,y,z)=>new T.Vector3(x,y,z),cl=(x,a,b)=>Math.max(a,Math.min(b,x));
let R;
try{R=new T.WebGLRenderer({antialias:true});if(!R.getContext())throw 0}catch(e){$('#wfall').hidden=false;return{show(){}}}
R.setPixelRatio(Math.min(devicePixelRatio||1,2));R.localClippingEnabled=true;R.domElement.setAttribute('aria-label','Interactive 3D well model. Drag to rotate, right-drag to pan, scroll or pinch to zoom.');box.prepend(R.domElement);
const sc=new T.Scene(),cam=new T.PerspectiveCamera(40,1,1.5,500),ctl=new T.OrbitControls(cam,R.domElement),plane=new T.Plane(V3(0,0,-1),0),rc=new T.Raycaster();
sc.background=new T.Color('#08090B');
sc.add(new T.AmbientLight(0xffffff,.6),new T.HemisphereLight(0xdde6f0,0x20242a,.5));
const dl=new T.DirectionalLight(0xffffff,.8);dl.position.set(40,70,90);sc.add(dl);
Object.assign(ctl,{enableDamping:true,dampingFactor:.08,minDistance:4,maxDistance:320,screenSpacePanning:true,minPolarAngle:.02,maxPolarAngle:Math.PI-.02});
const LO=V3(-40,-135,-40),HI=V3(40,12,40),DIR=V3(.55,.2,1).normalize();
/* shared noise texture for subtle rock variation */
const nc=document.createElement('canvas');nc.width=nc.height=64;{const g=nc.getContext('2d');for(let y=0;y<64;y++)for(let x=0;x<64;x++){const v=165+(Math.abs(Math.sin(x*12.9+y*78.2)*43758)%1)*90|0;g.fillStyle=`rgb(${v},${v},${v})`;g.fillRect(x,y,1,1)}}
const noise=new T.CanvasTexture(nc);noise.wrapS=noise.wrapT=T.RepeatWrapping;noise.repeat.set(6,2);
/* persistent particle system (reused for every well) */
const NP=260,pg=new T.BufferGeometry(),PP=new Float32Array(NP*3),PC=new Float32Array(NP*3);
pg.setAttribute('position',new T.BufferAttribute(PP,3));pg.setAttribute('color',new T.BufferAttribute(PC,3));
const pts=new T.Points(pg,new T.PointsMaterial({size:4,sizeAttenuation:false,vertexColors:true}));pts.frustumCulled=false;sc.add(pts);
const U=new Float32Array(NP),JX=new Float32Array(NP),JZ=new Float32Array(NP),OK=new Float32Array(NP);
for(let k=0;k<NP;k++){U[k]=k/NP;JX[k]=((k*.618)%1-.5)*.5;JZ[k]=((k*.382)%1-.5)*.5}
const OIL=new T.Color('#E7A33E'),WAT=new T.Color('#6FA8DC');

/* ---- well configuration (synthetic; built from the shared WELLS records) ---- */
const PTS={vertical:[[0,0],[0,-104]],deviated:[[0,0],[0,-30],[2,-50],[7,-70],[13,-88],[17,-104]],horizontal:[[0,0],[0,-40],[0,-68],[4,-82],[13,-91],[27,-95]]};
const MOCK_RESTRICTION={'WX-005':{tvd:44,severity:.6}};
function config(w){
  const i=WELLS.indexOf(w),kind=/Horizontal/.test(w.type)?'horizontal':/Deviated/.test(w.type)?'deviated':'vertical',sh=(i%3)*3;
  const L=[['Soil',6,'#5a4a38'],['Sandstone',18,'#8a7556'],['Shale',24,'#454b52'],['Limestone',24+sh,'#9a9c94'],['Caprock',12,'#30353b'],['Oil-bearing reservoir',14,'#6b4a1c'],['Water-bearing zone',12,'#2f5368'],['Basement rock',12,'#26292e']];
  let t=0;const layers=L.map(([n,h,c])=>{const o={n,top:t,h,c};t+=h;return o});
  const RT=layers[5].top,RB=RT+layers[5].h,f=(RB+6)/104;
  return{id:w.id,kind,layers,RT,RB,pts:PTS[kind].map(([x,y])=>[x,y*f]),status:w.status,flow:w.status==='Shut-in'?0:cl(w.cur.oil/520,.1,1),wf:w.cur.wc==null?0:w.cur.wc/100,restr:MOCK_RESTRICTION[w.id]||null,
    strings:[['Conductor casing',2.6,14],['Surface casing',2.1,RT*.4],['Intermediate casing',1.7,RT-8],['Production casing',1.3,RB+5]],tubeTvd:RT+5,perf:[RT+4,RB-2]};
}

/* ---- scene build ---- */
let G=null,cfg=null,CV=null,SP=null,N=0,pick=[],layerMats=[],groups={},hl=null,flowOn=true,cutOn=true,anchors=[],curId=null;
const uAt=tvd=>{for(let k=0;k<=400;k++)if(-CV.getPointAt(k/400).y>=tvd)return k/400;return 1};
function dispose(){if(!G)return;G.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose()});sc.remove(G);G=null;hl=null;lbl.innerHTML='';anchors=[]}
function build(w){
  dispose();const c=cfg=config(w);G=new T.Group();sc.add(G);pick=[];layerMats=[];
  const geoG=new T.Group(),pipG=new T.Group();G.add(geoG,pipG);groups={geo:geoG,pipes:pipG};
  const M=(color,o={})=>new T.MeshStandardMaterial({color,roughness:.8,metalness:0,...o});
  const clipM=m=>{m.clippingPlanes=[plane];m.side=T.DoubleSide;return m};
  const add=(g,m,name,desc)=>{m.userData={info:[name,desc],em:m.material.emissive?m.material.emissive.getHex():0};g.add(m);pick.push(m);return m};
  /* Geological strata: build side walls only for internal layer boundaries.
     Adjacent BoxGeometry meshes each had their own coplanar top/bottom faces;
     those faces compete in the depth buffer when the camera tilts. */
  function strataGeometry(l,index,total){
    const g=new T.BufferGeometry(),p=[],uv=[],idx=[];
    const quad=(a,b,c,d)=>{
      const base=p.length/3;
      for(const v of [a,b,c,d])p.push(...v);
      uv.push(0,0, 1,0, 1,1, 0,1);
      idx.push(base,base+1,base+2, base,base+2,base+3);
    };
    const x0=-30,x1=30,z0=-30,z1=30,yt=-l.top,yb=-(l.top+l.h);
    quad([x0,yb,z1],[x1,yb,z1],[x1,yt,z1],[x0,yt,z1]);
    quad([x1,yb,z0],[x0,yb,z0],[x0,yt,z0],[x1,yt,z0]);
    quad([x1,yb,z1],[x1,yb,z0],[x1,yt,z0],[x1,yt,z1]);
    quad([x0,yb,z0],[x0,yb,z1],[x0,yt,z1],[x0,yt,z0]);
    if(index===0)quad([x0,yt,z0],[x1,yt,z0],[x1,yt,z1],[x0,yt,z1]);
    if(index===total-1)quad([x0,yb,z1],[x1,yb,z1],[x1,yb,z0],[x0,yb,z0]);
    g.setAttribute('position',new T.Float32BufferAttribute(p,3));
    g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
    g.setIndex(idx);g.computeVertexNormals();return g;
  }
  c.layers.forEach((l,index)=>{
    const m=clipM(M(l.c,{map:noise,transparent:true,emissive:l.n.startsWith('Oil')?'#3a2406':'#000000'}));layerMats.push(m);
    const me=add(geoG,new T.Mesh(strataGeometry(l,index,c.layers.length),m),l.n,`${l.n}: synthetic layer, ${l.top}–${l.top+l.h} depth units. Not real formation data.`);
    me.position.y=-(l.top+l.h/2);
    /* Layer colours distinguish formations; avoid coplanar outline meshes, which can
       compete with the layer faces in the depth buffer during camera movement. */
  });
  /* trajectory + pipe strings (separate hollow tubes along the path) */
  CV=new T.CatmullRomCurve3(c.pts.map(([x,y])=>V3(x,y,0)));
  const tube=(u0,u1,r,m,n=40)=>{const p=[];for(let k=0;k<=n;k++)p.push(CV.getPointAt(u0+(u1-u0)*k/n));return new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(p),n*2,r,20,false),m)};
  let prev=0;
  c.strings.forEach(([n,r,tvd],i)=>{
    const u=uAt(tvd),pm=clipM(M(['#8a9099','#7d848d','#9199a2','#6f7780'][i],{metalness:.7,roughness:.4,transparent:true,opacity:.6,depthWrite:false}));
    add(pipG,tube(0,u,r,pm),n,`${n}: synthetic diameter and setting depth, exaggerated for visibility.`);
    add(pipG,tube(prev,u,r+.3,clipM(M('#b8a58a',{transparent:true,opacity:.35,depthWrite:false}))),'Cement',`Cement sheath outside ${n} (illustrative).`);prev=u;
  });
  const uT=uAt(c.tubeTvd);
  add(pipG,tube(0,uT,.65,clipM(M('#d5dbe2',{metalness:.5,roughness:.35,transparent:true,opacity:.5,depthWrite:false}))),'Production tubing','Production tubing inside the production casing. The gap between tubing and casing is the annulus. Synthetic dimensions.');
  const uP=uAt(c.RT+2),pk=tube(uP-.012,uP+.012,1,clipM(M('#3a3d42')),6);add(pipG,pk,'Packer','Packer seals the annulus above the perforated interval (illustrative).');
  /* perforations: 8 levels x 4 shots */
  const pf=new T.InstancedMesh(new T.CylinderGeometry(.14,.14,2.6,6),M('#ff6a3d',{emissive:'#7a2a12'}),32),dm=new T.Object3D(),starts=[];let q=0;
  for(let a=0;a<8;a++){
    const u=uAt(c.perf[0]+(c.perf[1]-c.perf[0])*a/7),p=CV.getPointAt(u),nm=new T.Vector3().crossVectors(V3(0,0,1),CV.getTangentAt(u)).normalize();
    for(let b=0;b<4;b++){const ang=b*Math.PI/2+(a%2)*Math.PI/4,d=nm.clone().multiplyScalar(Math.cos(ang)).add(V3(0,0,Math.sin(ang)));
      dm.position.copy(p).addScaledVector(d,2.1);dm.quaternion.setFromUnitVectors(V3(0,1,0),d);dm.updateMatrix();pf.setMatrixAt(q++,dm.matrix);starts.push(p.clone().addScaledVector(d,6))}
  }
  add(pipG,pf,'Perforations','Perforations connect the production casing to the oil-bearing reservoir (illustrative).');
  let vR=null;
  if(c.restr){const u=uAt(c.restr.tvd),rs=new T.Mesh(new T.CylinderGeometry(.62,.25,1.2,16),M('#C45B55',{emissive:'#5a1f1c'}));rs.position.copy(CV.getPointAt(u));rs.quaternion.setFromUnitVectors(V3(0,1,0),CV.getTangentAt(u));
    add(pipG,rs,'Simulated restriction','Restriction explicitly set in this well’s mock configuration. It is a demonstration object, not a finding.');vR=1-u/uT}
  /* surface equipment */
  const st=M('#8d949c',{metalness:.7,roughness:.4}),rd=M('#B04A44',{metalness:.5,roughness:.5}),cyl=(r,h,x,y,m=st)=>{const o=new T.Mesh(new T.CylinderGeometry(r,r,h,24),m);o.position.set(x,y,0);return o};
  add(G,cyl(3.2,1.6,0,.8),'Casing head','Surface casing head supporting the casing strings (illustrative).');
  add(G,cyl(2.4,1.2,0,2.2),'Tubing head','Tubing head suspends the production tubing (illustrative).');
  const mv=new T.Mesh(new T.BoxGeometry(2.2,2,2.2),rd);mv.position.y=3.8;add(G,mv,'Master valve','Master valve on the production tree (illustrative).');
  add(G,cyl(1.1,2.4,0,6),'Production tree','Production tree directing flow from the tubing to the flowline.');
  add(G,cyl(.6,1,0,7.7),'Tree cap','Swab cap at the top of the tree.');
  const wv=new T.Mesh(new T.BoxGeometry(1.6,1.6,1.6),rd);wv.position.set(-4.2,6,0);add(G,wv,'Wing valve','Wing valve on the production outlet.');
  const fl=new T.Mesh(new T.CylinderGeometry(.55,.55,21,16),st);fl.rotation.z=Math.PI/2;fl.position.set(-12.5,6,0);add(G,fl,'Surface flowline','Surface flowline from the production outlet to a separator vessel (illustrative).');
  add(G,cyl(.3,6,-16,3),'Flowline support','Pipe support.');add(G,cyl(3,7,-26,3.5),'Separator vessel','Simplified surface vessel (illustrative).');
  /* flow path: tubing bottom -> wellhead -> flowline, resampled by arc length */
  const pl=[];for(let k=0;k<=50;k++)pl.push(CV.getPointAt(uT*(1-k/50)));pl.push(V3(0,6,0),V3(-23,6,0));
  const cum=[0];for(let k=1;k<pl.length;k++)cum.push(cum[k-1]+pl[k].distanceTo(pl[k-1]));
  const M2=200,sp=new Float32Array((M2+1)*3);
  for(let k=0,j=0;k<=M2;k++){const s=cum[cum.length-1]*k/M2;while(j<cum.length-2&&cum[j+1]<s)j++;const f=(s-cum[j])/(cum[j+1]-cum[j]||1),a=pl[j],b=pl[j+1];sp.set([a.x+(b.x-a.x)*f,a.y+(b.y-a.y)*f,a.z+(b.z-a.z)*f],k*3)}
  SP={sp,M2,st:starts,vR:vR==null?null:cum[50]*vR/cum[cum.length-1]};
  N=Math.round(NP*c.flow);pg.setDrawRange(0,N);
  for(let k=0;k<NP;k++){const col=((k*.618034)%1)<c.wf?WAT:OIL;PC.set([col.r,col.g,col.b],k*3);OK[k]=((k*.754877)%1)<(c.restr?1-.75*c.restr.severity:1)?1:0}
  pg.attributes.color.needsUpdate=true;
  /* labels (HTML overlay anchored to 3D points) */
  const at=(tvd,dx=0)=>{const p=CV.getPointAt(uAt(tvd)).clone();p.x+=dx;return p};
  anchors=[['Production tree',V3(0,7.8,0)],['Surface flowline',V3(-12.5,6.8,0)],['Conductor casing',at(7,2.6)],['Production casing + cement',at(c.RT-35,1.6)],['Production tubing',at(c.RT-22)],['Annulus',at(c.RT-12,.97)],['Packer',at(c.RT+2,1.4)],['Perforations',at(c.perf[0]+4,2.8)],['Oil reservoir',V3(-30,-(c.RT+8),0)],['Water zone',V3(-30,-(c.RB+6),0)]];
  if(c.restr)anchors.push(['Simulated restriction (mock)',at(c.restr.tvd,.9)]);
  anchors.forEach(a=>{const d=document.createElement('div');d.className='lb';d.textContent=a[0];lbl.appendChild(d);a.push(d)});
  applyToggles();
  inf.textContent=`${c.id}: ${c.kind} trajectory, ${c.status}. ILLUSTRATIVE CONFIGURATION — synthetic dimensions, depths and flow factor ${c.flow.toFixed(2)}${c.status==='Shut-in'?' (shut-in: flow animation stopped)':''}${c.restr?`; mock restriction at ${c.restr.tvd} depth units`:''}. Click a component for details.`;
}
function applyToggles(){
  plane.constant=cutOn?0:1e4;
  layerMats.forEach(m=>{m.transparent=!cutOn;m.opacity=cutOn?1:.22;m.depthWrite=cutOn;m.needsUpdate=true});
  pts.visible=flowOn&&N>0;
  $$('[data-t]').forEach(c=>{const t=c.dataset.t;if(t==='geo'&&groups.geo)groups.geo.visible=c.checked;if(t==='pipes'&&groups.pipes)groups.pipes.visible=c.checked;if(t==='labels')lbl.hidden=!c.checked});
}
$$('[data-t]').forEach(c=>c.onchange=()=>{if(c.dataset.t==='flow')flowOn=c.checked;if(c.dataset.t==='cut')cutOn=c.checked;applyToggles()});

/* ---- camera ---- */
let tw=null,placed=false;
const fitD=()=>{const t=Math.tan(T.MathUtils.degToRad(cam.fov/2));return Math.max(72/t,38/(t*cam.aspect))};
function viewOf(n){
  const mid=V3(0,-54,0),c=cfg;
  if(n==='top')return[V3(0,80,.01),V3(0,0,0)];
  if(n==='res'){const t=CV.getPointAt(uAt((c.RT+c.RB)/2));return[t.clone().addScaledVector(V3(.4,.15,1).normalize(),34),t]}
  if(n==='bh'){const t=CV.getPointAt(uAt(c.tubeTvd));return[t.clone().addScaledVector(V3(.4,.15,1).normalize(),15),t]}
  const d=n==='fit'?cam.position.clone().sub(ctl.target).normalize():DIR;
  return[mid.clone().addScaledVector(d,fitD()),mid];
}
function setView(n,instant){
  if(!cfg)return;const[p,t]=viewOf(n),ms=instant||matchMedia('(prefers-reduced-motion: reduce)').matches?0:600;
  if(!ms){cam.position.copy(p);ctl.target.copy(t);tw=null;return}
  tw={p0:cam.position.clone(),p1:p,q0:ctl.target.clone(),q1:t,t0:performance.now(),ms};
}
const map={full:'full',reset:'full',fit:'fit',top:'top',res:'res',bh:'bh'};
$$('[data-v]').forEach(b=>b.onclick=()=>{
  const v=b.dataset.v;tw=null;
  if(v==='in'||v==='out'){const k=v==='in'?.8:1.25,d=cam.position.clone().sub(ctl.target),l=cl(d.length()*k,ctl.minDistance,ctl.maxDistance);cam.position.copy(ctl.target).addScaledVector(d.normalize(),l)}
  else setView(map[v]);
});

/* ---- pick / highlight ---- */
const vis=o=>{while(o){if(!o.visible)return false;o=o.parent}return true};
let dn=null;
R.domElement.addEventListener('pointerdown',e=>{dn=[e.clientX,e.clientY]});
R.domElement.addEventListener('pointerup',e=>{
  if(!dn||Math.hypot(e.clientX-dn[0],e.clientY-dn[1])>5)return;
  const r=R.domElement.getBoundingClientRect();rc.setFromCamera(new T.Vector2((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1),cam);
  const h=rc.intersectObjects(pick,false).find(x=>vis(x.object));
  if(hl&&hl.material.emissive)hl.material.emissive.setHex(hl.userData.em);
  hl=h?h.object:null;
  if(hl){if(hl.material.emissive)hl.material.emissive.setHex(0x6b4a14);inf.textContent=hl.userData.info.join(': ')}
});

/* ---- loop (paused when off-screen or tab hidden) ---- */
let raf=0,last=0,vsb=false,W=1,H=1;const lv=V3(0,0,0);
function flow(dt){
  if(!flowOn||!N||!SP)return;const{sp,M2,st,vR}=SP,A=.14;
  for(let k=0;k<N;k++){
    const s=U[k]=(U[k]+dt*.16)%1;let x,y,z;
    if(s<A){const q=s/A,a=st[k%st.length];x=a.x+(sp[0]-a.x)*q;y=a.y+(sp[1]-a.y)*q;z=a.z+(sp[2]-a.z)*q}
    else{let v=(s-A)/(1-A);if(vR!=null&&v>vR&&!OK[k])v=vR;const idx=v*M2,i=Math.min(M2-1,idx|0),f=idx-i,o=i*3;
      x=sp[o]+(sp[o+3]-sp[o])*f;y=sp[o+1]+(sp[o+4]-sp[o+1])*f;z=sp[o+2]+(sp[o+5]-sp[o+2])*f}
    PP[k*3]=x+JX[k];PP[k*3+1]=y;PP[k*3+2]=z+JZ[k];
  }
  pg.attributes.position.needsUpdate=true;
}
function loop(now){
  raf=requestAnimationFrame(loop);const dt=Math.min(.05,(now-last)/1000||0);last=now;
  if(tw){const k=Math.min(1,(now-tw.t0)/tw.ms),e=k*k*(3-2*k);cam.position.lerpVectors(tw.p0,tw.p1,e);ctl.target.lerpVectors(tw.q0,tw.q1,e);if(k>=1)tw=null}
  ctl.target.clamp(LO,HI);ctl.update();flow(dt);R.render(sc,cam);
  if(!lbl.hidden)anchors.forEach(a=>{lv.copy(a[1]).project(cam);const d=a[2];if(lv.z>1){d.style.display='none';return}d.style.display='';d.style.transform=`translate(${(lv.x*.5+.5)*W}px,${(-lv.y*.5+.5)*H}px) translateY(-50%)`});
}
const run=()=>{if(!raf&&vsb&&!document.hidden){last=performance.now();raf=requestAnimationFrame(loop)}},stop=()=>{cancelAnimationFrame(raf);raf=0};
new IntersectionObserver(e=>{vsb=e[0].isIntersecting;vsb?run():stop()}).observe(box);
document.addEventListener('visibilitychange',()=>document.hidden?stop():run());
function resizeAndDraw(){
  const w=box.clientWidth,h=box.clientHeight;if(!w||!h)return false;
  R.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix();W=w;H=h;
  if(!placed&&cfg){placed=true;setView('full',true)}
  R.render(sc,cam);
  return true;
}
new ResizeObserver(()=>{resizeAndDraw();if(box.getBoundingClientRect().width>0)run()}).observe(box);
return{show(w){
  try{
    if(curId!==w.id){curId=w.id;build(w);if(placed)tw=null}
    resizeAndDraw();
    vsb=box.getBoundingClientRect().width>0&&box.getBoundingClientRect().height>0;
    if(vsb)run();
  }catch(e){
    console.error('WELL-X 3D model failed to initialize:',e);
    const f=$('#wfall');f.hidden=false;f.textContent='The 3D well model could not initialize. Check the browser console for details.';
  }
}};
})();
if(!$('#p-analysis').hidden)Well3D.show(cur());