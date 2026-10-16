import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

test('client renders teacher background and voting; pointer drag commits target and student has no handles',async()=>{
  const listeners={},elements=new Map();
  function element(){const classes=new Set();return {innerHTML:'',style:{},classList:{add(...c){c.forEach(x=>classes.add(x));},remove(...c){c.forEach(x=>classes.delete(x));},contains(c){return classes.has(c);}}};}
  const source=element(),target=element();source.dataset={post:'a'};target.dataset={post:'b'};
  target.closest=()=>target;target.getBoundingClientRect=()=>({top:100,height:200});
  const doc={querySelector(s){if(!elements.has(s))elements.set(s,element());return elements.get(s);},querySelectorAll(){return[source,target];},elementFromPoint(){return target;},addEventListener(type,fn){(listeners[type]||=[]).push(fn);}};
  const context=vm.createContext({document:doc,console,window:{innerHeight:900,scrollBy(){}},setTimeout,clearTimeout});
  const code=readFileSync(new URL('../public/app.js',import.meta.url),'utf8').replace(/init\(\);\s*$/,'');
  vm.runInContext(code,context);
  const post=id=>({id,color:'cream',title:id,body:'test',authorId:'student',authorName:'學生',createdAt:'2026-10-16T00:00:00Z',status:'published',links:[],attachments:[],comments:[],section:'分享',voteCount:1,voted:id==='a'});
  context.initial={id:'wall',version:3,title:'牆',domain:'school.edu.tw',description:'',layout:'grid',lifecycle:'active',isOwner:true,votingEnabled:true,sections:['分享'],posts:[post('a'),post('b')],sync:{demo:true},background:{id:'bg',mode:'width'}};
  vm.runInContext("board=initial;session={user:{id:'teacher'},demo:true};view='grid';renderBoard();",context);
  const surface=elements.get('#wall-surface');assert.equal(surface.style.backgroundRepeat,'repeat-y');assert.equal(surface.style.backgroundSize,'100% auto');assert.match(surface.style.backgroundImage,/\/api\/boards\/wall\/background\/bg/);
  assert.match(elements.get('#posts').innerHTML,/data-drag="a"/);assert.match(elements.get('#posts').innerHTML,/✓ 已投票/);
  let captured;const handle={dataset:{drag:'a'},setPointerCapture(id){captured=id;},closest(){return source;}};
  await listeners.pointerdown[0]({target:{closest:()=>handle},button:0,pointerId:7,preventDefault(){}});assert.equal(captured,7);assert.equal(source.classList.contains('dragging'),true);
  await listeners.pointermove[0]({pointerId:7,clientX:200,clientY:150,preventDefault(){}});assert.equal(target.classList.contains('drop-before'),true);
  vm.runInContext('movePost=async (...args)=>{globalThis.move=args;};',context);
  await listeners.pointerup[0]({pointerId:7});assert.deepEqual(Array.from(context.move),['a','b','before']);assert.equal(source.classList.contains('dragging'),false);
  vm.runInContext("board.isOwner=false;session.user.id='student';renderPosts();",context);
  assert.ok(!elements.get('#posts').innerHTML.includes('data-drag='));assert.match(elements.get('#posts').innerHTML,/data-action="vote"/);
});
