import React, { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// TOKENS
// ============================================================
const T={bg0:"#0A0B0F",bg1:"#111318",bg2:"#191C24",bg3:"#22263A",cyan:"#00E5FF",amber:"#FFB300",red:"#FF3B5C",green:"#00E676",purple:"#B388FF",orange:"#FF6D00",teal:"#00BFA5",textPri:"#E8EAED",textSec:"#8B90A0",textMut:"#4A4F60",border:"#2A2F45"};

// ============================================================
// MODELS & DIFFICULTY
// ============================================================
const OPENAI_MODELS=[
  {id:"gpt-4o",label:"GPT-4o",desc:"Fast, smart — recommended",tier:"standard"},
  {id:"gpt-4o-mini",label:"GPT-4o Mini",desc:"Fastest & cheapest",tier:"fast"},
  {id:"gpt-4-turbo",label:"GPT-4 Turbo",desc:"Longer context",tier:"standard"},
  {id:"o1-mini",label:"o1 Mini",desc:"Strong reasoning",tier:"advanced"},
  {id:"o1",label:"o1",desc:"Max intelligence",tier:"advanced"},
];
const DIFFICULTY={
  easy:{id:"easy",label:"Rookie Detective",icon:"🟢",desc:"2 critical clues found free. Unlimited hints. Suspects crack fast. 30-min timer.",freeClues:2,unlimitedHints:true,crackMultiplier:0.6,lieDetectorForce:true,reverseQuestions:2,timerMinutes:30,permadeath:false},
  medium:{id:"medium",label:"Detective",icon:"🟡",desc:"Standard experience. 1 hint. Balanced difficulty. 20-min timer.",freeClues:0,unlimitedHints:false,crackMultiplier:1.0,lieDetectorForce:false,reverseQuestions:3,timerMinutes:20,permadeath:false},
  hard:{id:"hard",label:"Chief Inspector",icon:"🔴",desc:"No hints. Hard cracking. Wrong accusation = game over. 15-min timer.",freeClues:0,unlimitedHints:false,crackMultiplier:1.8,lieDetectorForce:false,reverseQuestions:4,timerMinutes:15,permadeath:true},
};
const TIMER_OPTIONS=[{v:0,l:"Off"},{v:15,l:"15 min"},{v:20,l:"20 min"},{v:30,l:"30 min"},{v:45,l:"45 min"}];

// ============================================================
// SUSPECT MOODS
// ============================================================
const MOODS={
  cooperative:{id:"cooperative",label:"Cooperative",icon:"😌",color:"#00E676",desc:"Open, willing to talk. Extra details slip out."},
  nervous:{id:"nervous",label:"Nervous",icon:"😰",color:"#FFB300",desc:"Anxious. Prone to contradictions under soft pressure."},
  defensive:{id:"defensive",label:"Defensive",icon:"😤",color:"#FF6D00",desc:"Guarded. Short answers. Deflects questions."},
  hostile:{id:"hostile",label:"Hostile",icon:"😠",color:"#FF3B5C",desc:"Refuses to elaborate. May shut down entirely."},
};
function getMoodFromCount(count,isGuilty){
  if(count===0) return isGuilty?"nervous":"cooperative";
  if(count<=2)  return isGuilty?"defensive":"nervous";
  if(count<=4)  return isGuilty?"hostile":"defensive";
  return isGuilty?"hostile":"cooperative"; // breaks under extended pressure
}

// ============================================================
// LOGGER
// ============================================================
class GameLogger{
  constructor(){this.logs=[];this.listeners=[];this.sessionId=`s_${Date.now()}`;}
  _emit(lv,cat,msg,data={}){
    const e={id:`l_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,timestamp:new Date().toISOString(),level:lv,category:cat,message:msg,data:typeof data==="object"?JSON.stringify(data):String(data)};
    this.logs.push(e);if(this.logs.length>500)this.logs.shift();
    this.listeners.forEach(fn=>fn(e));
    const s={DEBUG:"color:#4A4F60",INFO:"color:#00E5FF",WARN:"color:#FFB300",ERROR:"color:#FF3B5C;font-weight:bold"};
    console.log(`%c[CZ][${lv}][${cat}] ${msg}`,s[lv]||"",data);
  }
  debug(c,m,d){this._emit("DEBUG",c,m,d);}info(c,m,d){this._emit("INFO",c,m,d);}
  warn(c,m,d){this._emit("WARN",c,m,d);}error(c,m,d){this._emit("ERROR",c,m,d);}
  onLog(fn){this.listeners.push(fn);return()=>{this.listeners=this.listeners.filter(l=>l!==fn)};}
  getLogs(){return[...this.logs];}export(){return JSON.stringify(this.logs,null,2);}
  clear(){this.logs=[];this.listeners.forEach(fn=>fn({type:"clear"}));}
}
const logger=new GameLogger();

// ============================================================
// AI ENGINE — OpenAI ONLY, no Claude fallback
// ============================================================
const AI_ERROR_PREFIX="[AI_ERROR]";
function isAIError(txt){return!txt||txt.startsWith(AI_ERROR_PREFIX)||txt.startsWith("[");}

async function callAI(prompt,systemPrompt="",context="generic",settings={}){
  const callId=`ai_${Date.now()}`;
  const model=settings.openaiModel||"gpt-4o";
  logger.info("AI",`[${model}] ${context}`,{callId,promptLen:prompt.length});
  if(!settings.openaiKey){
    logger.warn("AI","No API key",{callId});
    return `${AI_ERROR_PREFIX} No OpenAI API key. Go to ⚙ Settings and add your key.`;
  }
  try{
    const isO1=model.startsWith("o1");
    const messages=isO1
      ?[{role:"user",content:`${systemPrompt}\n\n${prompt}`}]
      :[{role:"system",content:systemPrompt||"You power a detective mystery game. Be concise, dramatic, immersive."},{role:"user",content:prompt}];
    const body={model,messages,max_tokens:isO1?2000:1000};
    if(!isO1)body.temperature=0.85;
    const res=await fetch("https://api.openai.com/v1/chat/completions",{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${settings.openaiKey}`},
      body:JSON.stringify(body),
    });
    if(!res.ok){
      let errBody="";
      try{const ej=await res.json();errBody=ej?.error?.message||JSON.stringify(ej);}catch{errBody=await res.text().catch(()=>"");}
      logger.error("AI",`HTTP ${res.status}`,{callId,errBody:errBody.slice(0,200)});
      if(res.status===401)return`${AI_ERROR_PREFIX} Invalid API key (401). Check Settings.`;
      if(res.status===429)return`${AI_ERROR_PREFIX} Rate limit hit (429). Wait a moment.`;
      if(res.status===400)return`${AI_ERROR_PREFIX} Bad request (400): ${errBody.slice(0,80)}`;
      return`${AI_ERROR_PREFIX} OpenAI error ${res.status}: ${errBody.slice(0,100)}`;
    }
    let data;
    try{data=await res.json();}
    catch(e){logger.error("AI","JSON parse fail",{callId});return`${AI_ERROR_PREFIX} Response parse failed.`;}
    const text=data?.choices?.[0]?.message?.content?.trim();
    if(!text){logger.warn("AI","Empty content",{callId});return`${AI_ERROR_PREFIX} Empty response from model.`;}
    logger.info("AI",`OK [${context}]`,{callId,len:text.length});
    return text;
  }catch(err){
    logger.error("AI",`threw: ${err.message}`,{callId,context});
    return`${AI_ERROR_PREFIX} ${err.message}`;
  }
}

// Safe JSON parse from AI response
function safeParseJSON(raw,fallback={}){
  if(isAIError(raw))return{...fallback,_error:raw};
  try{return JSON.parse(raw.replace(/```json|```/g,"").trim());}
  catch{
    // try to extract first JSON object from messy response
    const m=raw.match(/\{[\s\S]*\}/);
    if(m)try{return JSON.parse(m[0]);}catch{}
    logger.warn("AI","JSON extract failed",{raw:raw.slice(0,100)});
    return{...fallback,_parseError:true,_raw:raw.slice(0,200)};
  }
}

async function speakText(text,settings){
  if(!settings.voiceEnabled||!settings.elevenLabsKey||!settings.elevenLabsVoiceId||isAIError(text))return;
  try{
    const res=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${settings.elevenLabsVoiceId}`,{
      method:"POST",headers:{"xi-api-key":settings.elevenLabsKey,"Content-Type":"application/json"},
      body:JSON.stringify({text,model_id:"eleven_monolingual_v1"}),
    });
    if(!res.ok){logger.error("TTS",`HTTP ${res.status}`);return;}
    new Audio(URL.createObjectURL(await res.blob())).play();
  }catch(e){logger.warn("TTS",e.message);}
}

// ============================================================
// CASES
// ============================================================
const TUTORIAL_CASE={
  id:"tutorial",title:"The Missing Trophy",setting:"Millbrook High School, after hours",
  summary:"The school's championship trophy vanished overnight. Three people had access. This is your first case — the game will guide you.",
  victim:"Championship Trophy — sentimental value only",cause:"Taken out of spite after losing team captain position",
  killer:"Coach Harris",
  killerReason:"Coach Harris was passed over for the head coaching role and took the trophy in a fit of rage, blaming the team's star player.",
  isTutorial:true,
  tutorialSteps:[
    {phase:"detective",room:"Gym Storage",message:"👋 Welcome Detective! Start by exploring rooms. Click a clue card to discover evidence. Try the Gym Storage first."},
    {phase:"detective",clue:"c1",message:"🔎 Great find! Critical clues (marked in amber) are key to solving the case. Look for more evidence in other rooms."},
    {phase:"interrogation",message:"💬 Now switch to Interrogation mode using the nav bar. Select a suspect and ask them a question — try a suggested one first."},
    {phase:"cross",message:"⚔ Try Cross-Examination! Select a suspect and pick a tactic to press their contradiction. Watch the pressure meter."},
    {phase:"witnesses",message:"👁 Check the Witnesses tab. Witnesses give scripted statements — click 'Initial Statement' to hear what they saw."},
    {phase:"accuse",message:"⚖ You're ready to accuse! Hit the Accuse button in the nav. Choose carefully — you only get one shot."},
  ],
  suspects:[
    {id:"coach",name:"Coach Harris",role:"Head Coach",age:52,alibi:"Claims he was home all evening",secret:"His keycard was swiped at 11pm — well after school closed",guilty:true,
     dossier:{background:"25yr coaching veteran. Recently passed over for head coach promotion.",knownAssociates:"School board, rival coaches",priorRecord:"None",financials:"Salary cut last year."},
     timeline:[{time:"5:00pm",action:"Practice ended"},{time:"6:00pm",action:"Left school — claimed"},{time:"11:00pm",action:"Keycard swipe detected at gym"}]},
    {id:"captain",name:"Jamie Chen",role:"Team Captain",age:17,alibi:"Was at a team dinner until midnight — 8 witnesses",secret:"Had argued with coach earlier about playing time",guilty:false,
     dossier:{background:"Star player. Had public argument with Coach Harris last week.",knownAssociates:"Team members, school staff",priorRecord:"None",financials:"N/A"},
     timeline:[{time:"4:00pm",action:"Practice"},{time:"6:00pm",action:"Team dinner — confirmed"},{time:"12:00am",action:"Still at dinner"}]},
    {id:"janitor",name:"Mr. Reeves",role:"Night Janitor",age:60,alibi:"Was cleaning the east wing all night",secret:"Has a personal grudge with the previous janitor who got fired",guilty:false,
     dossier:{background:"6yr school employee. Clean record.",knownAssociates:"School staff",priorRecord:"None",financials:"Standard salary."},
     timeline:[{time:"8:00pm",action:"Started shift — east wing"},{time:"11:00pm",action:"Break room"},{time:"1:00am",action:"Finished shift"}]},
  ],
  clues:[
    {id:"c1",name:"Muddy boot print",description:"Size 13 boot print near the trophy case. Only Coach Harris wears size 13 on staff.",found:false,critical:true,room:"Gym Storage"},
    {id:"c2",name:"Keycard log",description:"Coach Harris' keycard was swiped at 11:04pm — 5 hours after he claims he left.",found:false,critical:true,room:"Security Office"},
    {id:"c3",name:"Dropped pen",description:"A red coach's pen near the case. Coach Harris' initials on it.",found:false,critical:false,room:"Gym Storage"},
    {id:"c4",name:"Team dinner receipt",description:"Jamie's credit card receipt — 6:15pm to 12:05am. Airtight alibi.",found:false,critical:false,room:"Cafeteria"},
    {id:"c5",name:"Cleaning log",description:"Mr. Reeves signed into east wing at 8:02pm. He was never near the gym.",found:false,critical:false,room:"Janitor Closet"},
  ],
  rooms:["Gym Storage","Security Office","Cafeteria","Janitor Closet"],
  witnesses:[
    {id:"w1",name:"Student Sara",role:"Late-night student",avatar:"🧑‍🎓",summary:"Stayed late for a project. Saw someone in the hallway.",
     statements:[{trigger:"general",text:"I was printing my project around 11pm. I saw someone in a blue track jacket walking fast toward the gym. I didn't think much of it — then I heard the trophy case alarm go off minutes later."},
     {trigger:"coach",text:"The track jacket was definitely the school's coach edition. Only staff coaches get those. I'd recognize that jacket anywhere."}]},
  ],
  interrogationQuestions:{
    coach:[{q:"Your keycard shows you entered at 11pm. Explain that."},{q:"Do you own a pair of size 13 boots?"}],
    captain:[{q:"Can anyone confirm you were at dinner all night?"},{q:"Tell me about your argument with Coach Harris."}],
  },
  reverseInterrogation:{
    detective_alibi:"I was off-duty and called in by the school principal.",
    detective_secret:"You used to be on this school's rival team in your youth.",
    ai_questions:["Your personal history with this school — you played for the rival team. Doesn't that bias you?","You arrived 30 minutes before you were called. How is that possible?"],
  },
  crossExam:{
    coach:{contradiction:"Coach Harris claims he left at 6pm but his keycard log shows entry at 11:04pm.",pressure_point:"the keycard log",crack_threshold:1},
  },
};

const BUILT_IN_CASES=[
  {
    id:"gala-poison",title:"The Crimson Gala",setting:"Luxury rooftop gala, midnight",
    summary:"A billionaire found dead at his own birthday party. The champagne flute still in his hand.",
    victim:"Victor Harmon, 67, CEO of Harmon Industries",cause:"Cyanide poisoning in the champagne",
    killer:"Diana Voss",
    killerReason:"Diana was his PA for 12 years and was removed from his will after discovering plans to sell the company and leave her nothing.",
    narratorIntro:"The city never sleeps, but tonight it holds its breath. Victor Harmon — a man who bought and sold empires — is dead. And somewhere in this room, someone is celebrating.",
    suspects:[
      {id:"diana",name:"Diana Voss",role:"Personal Assistant",age:34,alibi:"Claims she was at the bar the entire time",secret:"Was seen near the victim's drink 10 minutes before death",guilty:true,
       dossier:{background:"12-year PA. Privy to all secrets. Removed from will last week.",knownAssociates:"Board of Harmon Industries, estate lawyer",priorRecord:"None",financials:"$95k salary. Maxed credit cards."},
       timeline:[{time:"9:00pm",action:"Arrived with Victor"},{time:"10:30pm",action:"Seen arguing with Victor near suite"},{time:"11:40pm",action:"Near bar — unconfirmed"},{time:"11:47pm",action:"Camera gap"},{time:"11:52pm",action:"Returned to bar visibly flushed"}]},
      {id:"marcus",name:"Marcus Harmon",role:"Son & Heir",age:42,alibi:"Was giving a speech on stage",secret:"Has $2.1M gambling debts",guilty:false,
       dossier:{background:"Victor's son. Runs a failing property firm.",knownAssociates:"Debt collectors, lawyers",priorRecord:"DUI 2018",financials:"$2.1M gambling debt."},
       timeline:[{time:"9:00pm",action:"Arrived late"},{time:"10:00pm",action:"Speech on stage — 60 witnesses"},{time:"11:30pm",action:"Bar — whiskeys"},{time:"12:00am",action:"Still at bar"}]},
      {id:"elena",name:"Elena Vance",role:"Business Rival",age:55,alibi:"Left early — valet confirmed 11:15pm",secret:"Secret merger talks with victim",guilty:false,
       dossier:{background:"CEO of VanceCorp, Victor's rival 20 years.",knownAssociates:"Wall Street brokers",priorRecord:"None",financials:"Net worth $340M."},
       timeline:[{time:"9:00pm",action:"Arrived alone"},{time:"11:15pm",action:"Departed — valet confirmed"}]},
      {id:"chef",name:"Chef Remy Blanc",role:"Head Caterer",age:48,alibi:"In kitchen all night — 3 witnesses",secret:"Blackmailed by Victor over health code violation",guilty:false,
       dossier:{background:"Renowned chef. Catered Harmon events 7 years.",knownAssociates:"Kitchen staff",priorRecord:"Obstruction 2019",financials:"Restaurant struggling."},
       timeline:[{time:"6:00pm",action:"Setup"},{time:"11:00pm",action:"Kitchen — confirmed"},{time:"12:00am",action:"Still in kitchen"}]},
    ],
    clues:[
      {id:"c1",name:"Cyanide residue",description:"Found only in victim's flute — targeted, not open bottles.",found:false,critical:true,room:"Rooftop Bar"},
      {id:"c2",name:"Broken nail fragment",description:"Acrylic nail near drink station. Matches Diana's missing thumbnail.",found:false,critical:true,room:"Rooftop Bar"},
      {id:"c3",name:"Deleted calendar entry",description:"Victor's phone: deleted meeting 'D.V. — severance terms' for tomorrow.",found:false,critical:false,room:"Victim's Private Suite"},
      {id:"c4",name:"Security camera gap",description:"Footage 11:43-11:47pm near bar manually looped.",found:false,critical:false,room:"Security Office"},
      {id:"c5",name:"Bar receipt",description:"Marcus ordered 6 whiskeys 10pm–midnight. Alibi airtight.",found:false,critical:false,room:"VIP Lounge"},
      {id:"c6",name:"Valet log",description:"Elena's car left 11:15pm — 35 min before TOD.",found:false,critical:false,room:"Kitchen Entrance"},
    ],
    rooms:["Rooftop Bar","VIP Lounge","Kitchen Entrance","Security Office","Victim's Private Suite"],
    witnesses:[
      {id:"w1",name:"Jake Torres",role:"Bartender",avatar:"🧑‍🍳",summary:"Worked the bar all night. Saw everything.",
       statements:[
         {trigger:"general",text:"It was a packed night. Mr. Harmon seemed fine early on. But around 11:30 I noticed Diana at the far end, just watching him. Didn't order anything. That was strange."},
         {trigger:"diana",text:"Diana was here — but not the whole time like she said. I stepped away to restock around 11:40. When I came back about 10 minutes later she was back, but her hands were shaking."},
         {trigger:"suspicious",text:"I found a small glass vial under the bar mat after everything happened. It smelled like almonds. I panicked and pocketed it. I should've told someone immediately."},
       ]},
      {id:"w2",name:"Clara Huang",role:"Gala Photographer",avatar:"📸",summary:"Shot the whole event. Long lens, sharp eye.",
       statements:[
         {trigger:"general",text:"People forget I'm there when I'm using the long lens. Diana was composed all night until about 11:35. She looked at her phone and her whole expression went cold."},
         {trigger:"diana",text:"I have a photo of Diana near the drink station at 11:44. She didn't know I was shooting from the stairwell. Her arm is reaching toward the bar."},
         {trigger:"camera",text:"The camera gap — I noticed it too. But whoever looped the feed didn't know about my SD card backup. I still have those four minutes."},
       ]},
    ],
    interrogationQuestions:{
      diana:[{q:"Where were you between 11:40 and 11:50pm?"},{q:"We found a nail fragment near the champagne — is that yours?"},{q:"When did you last speak to Victor today?"}],
      marcus:[{q:"How much debt are you carrying?"},{q:"Did you know your father was changing the will?"}],
    },
    reverseInterrogation:{
      detective_alibi:"I was reviewing crime scene photos and interviewing catering staff.",
      detective_secret:"You arrived 20 minutes late and used the service entrance.",
      ai_questions:["Your sign-in shows you used the service entrance — same one the killer likely used. Explain.","Your fingerprints were on the victim's glass. Why touch key evidence without gloves?","A witness says you argued with the victim at a charity event three weeks ago. What was that?","You took 20 minutes longer than protocol to secure the crime scene. What were you doing?"],
    },
    crossExam:{
      diana:{contradiction:"Diana claims she was at the bar all night — but the camera gap is 11:43-11:47pm, when she says she was standing right there.",pressure_point:"broken nail and camera gap",crack_threshold:2},
      marcus:{contradiction:"Marcus says the inheritance timing was terrible — yet he met an estate lawyer two weeks ago.",pressure_point:"secret lawyer meetings",crack_threshold:3},
    },
  },
  {
    id:"museum-heist",title:"The Missing Vermeer",setting:"City Modern Art Museum, 2am",
    summary:"A priceless Vermeer disappeared during a gala opening. The motion sensors never triggered.",
    victim:"Painting 'Girl with a Pearl Earring II' — $80M",cause:"Inside job — sensors disabled via master override",
    killer:"Noah Park",killerReason:"Noah was approached by a private collector 3 months ago and disabled sensors during a 4-minute guard rotation gap.",
    narratorIntro:"They say art is eternal. Tonight, $80 million worth of eternity walked out the front door. Somebody in this building knew exactly when to strike — and exactly how to vanish.",
    suspects:[
      {id:"noah",name:"Noah Park",role:"Head of Security",age:38,alibi:"Claims he was on his rounds",secret:"Offshore accounts with suspicious deposits",guilty:true,
       dossier:{background:"15yr security veteran. Former police. IA probe 2019.",knownAssociates:"Private collectors network",priorRecord:"IA investigation, no charges",financials:"Salary $62k. Offshore: $220k."},
       timeline:[{time:"8:00pm",action:"Shift start"},{time:"11:54pm",action:"Sensor override"},{time:"12:05am",action:"Called in theft himself"}]},
      {id:"curator",name:"Dr. Sofia Chen",role:"Lead Curator",age:51,alibi:"Gala dinner — 8 witnesses",secret:"Forged authentication papers 2022",guilty:false,
       dossier:{background:"20yr museum veteran. One authentication scandal.",knownAssociates:"Art world, auction houses",priorRecord:"None",financials:"$110k. Clean."},
       timeline:[{time:"7:00pm",action:"Gala setup"},{time:"9:00pm",action:"Donor dinner — confirmed"},{time:"12:10am",action:"First on scene"}]},
      {id:"restorer",name:"Kai Brennan",role:"Art Restorer",age:29,alibi:"Left at 10pm — badge confirmed",secret:"Has skills to replicate masterworks",guilty:false,
       dossier:{background:"Prodigy restorer. Known copier.",knownAssociates:"Private galleries",priorRecord:"None",financials:"Freelance."},
       timeline:[{time:"10:07pm",action:"Badge exit — 2hrs before theft"}]},
      {id:"patron",name:"Vivienne Lau",role:"Major Donor",age:63,alibi:"Table until midnight — 4 witnesses",secret:"Tried to buy this painting for 5 years",guilty:false,
       dossier:{background:"Billionaire collector. $4M offer declined.",knownAssociates:"Art brokers",priorRecord:"None",financials:"Net worth $1.2B."},
       timeline:[{time:"7:00pm",action:"Arrived"},{time:"11:45pm",action:"Still at table"}]},
    ],
    clues:[
      {id:"c1",name:"Sensor override log",description:"4-min disable at 11:58pm. Only Noah's credentials authorized.",found:false,critical:true,room:"Security Command Center"},
      {id:"c2",name:"Offshore wire transfer",description:"$180k to Noah's account from shell company — 72hrs post-theft.",found:false,critical:true,room:"Security Command Center"},
      {id:"c3",name:"Replica canvas",description:"Blank canvas same dimensions in Noah's locker.",found:false,critical:false,room:"Storage Vault"},
      {id:"c4",name:"Sofia's forgery file",description:"Not connected to theft but damages credibility.",found:false,critical:false,room:"Restorer's Workshop"},
      {id:"c5",name:"Kai's exit badge",description:"Confirmed exit 10:07pm — 2hrs before theft.",found:false,critical:false,room:"Gallery Hall A"},
      {id:"c6",name:"Vivienne's offer letter",description:"$4M private offer — declined 3 years ago.",found:false,critical:false,room:"Donor Lounge"},
    ],
    rooms:["Gallery Hall A","Security Command Center","Storage Vault","Restorer's Workshop","Donor Lounge"],
    witnesses:[
      {id:"w1",name:"Officer Ray Chen",role:"Junior Guard",avatar:"👮",summary:"On patrol. Saw Noah act unusually.",
       statements:[
         {trigger:"general",text:"Noah told me to take an extended 20-minute break that night. That never happens — he's usually strict about rotation. At the time I thought nothing of it."},
         {trigger:"noah",text:"I saw Noah near the sensor terminal room around 11:50. He said he was running a diagnostic. Now I realize the timeline matches exactly when the sensors went offline."},
         {trigger:"suspicious",text:"After the theft was reported, Noah was the calmest person in the room. In 5 years I've never seen him calm during an incident. It stuck with me."},
       ]},
    ],
    interrogationQuestions:{
      noah:[{q:"Walk me through your exact rounds at 11:50pm."},{q:"Someone used your credentials to disable the sensors."},{q:"$180,000 appeared in your account 72hrs after the theft."}],
      curator:[{q:"Tell me about the forged authentication certificate from 2022."},{q:"Did you notice anything unusual about Noah tonight?"}],
    },
    reverseInterrogation:{
      detective_alibi:"Called in after the fact.",
      detective_secret:"Your precinct received $50k from the museum foundation.",
      ai_questions:["Your precinct received $50k from the museum foundation last month. Does that compromise you?","You were seen dining with Vivienne Lau two weeks before the heist.","Your file shows you cleared Noah Park in a prior incident.","Three art theft cases this year — all unsolved. Why?"],
    },
    crossExam:{
      noah:{contradiction:"Noah says his keycard was stolen — but access logs show it was used at his personal locker 40 minutes before the theft.",pressure_point:"locker access timestamp",crack_threshold:2},
      curator:{contradiction:"Sofia denies knowing about the forgery file — but her own signature is on the cover page.",pressure_point:"the signature",crack_threshold:3},
    },
  },
];

const PLAYER_COLORS=["#00E5FF","#FFB300","#FF3B5C","#00E676","#B388FF","#FF6D00","#40C4FF","#F48FB1"];

// ============================================================
// CSS
// ============================================================
const css=`
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Space+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
body{background:#0A0B0F;color:#E8EAED;font-family:'Space Grotesk',sans-serif;min-height:100vh;overflow-x:hidden;}
.scanlines::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9998;background:repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.025) 2px,rgba(0,0,0,0.025) 4px);}
@keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes slideUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulseRed{0%,100%{box-shadow:0 0 0 0 #FF3B5C22}50%{box-shadow:0 0 24px 4px #FF3B5C44}}
@keyframes pulseAmber{0%,100%{box-shadow:0 0 0 0 #FFB30022}50%{box-shadow:0 0 18px 3px #FFB30044}}
@keyframes timerPulse{0%,100%{opacity:1}50%{opacity:0.4}}
@keyframes narratorSlide{from{opacity:0;transform:translateY(-10px)}to{opacity:1;transform:none}}
@keyframes moodPop{0%{transform:scale(0.7);opacity:0}100%{transform:scale(1);opacity:1}}
@keyframes forensicsScan{0%{transform:translateX(-100%)}100%{transform:translateX(100%)}}
.anim-fade{animation:fadeIn 0.4s ease both;}
.anim-up{animation:slideUp 0.5s ease both;}
.anim-narrator{animation:narratorSlide 0.5s ease both;}
.anim-mood{animation:moodPop 0.3s ease both;}
::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111318}::-webkit-scrollbar-thumb{background:#2A2F45;border-radius:2px}::-webkit-scrollbar-thumb:hover{background:#00E5FF}
.btn{display:inline-flex;align-items:center;gap:7px;padding:9px 17px;border-radius:6px;font-family:'Space Grotesk',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;border:1px solid transparent;letter-spacing:0.03em;text-transform:uppercase;}
.btn-cyan{background:#00E5FF18;border-color:#00E5FF66;color:#00E5FF;}.btn-cyan:hover{background:#00E5FF30;border-color:#00E5FF;box-shadow:0 0 14px #00E5FF44;}
.btn-amber{background:#FFB30018;border-color:#FFB30066;color:#FFB300;}.btn-amber:hover{background:#FFB30030;border-color:#FFB300;}
.btn-red{background:#FF3B5C18;border-color:#FF3B5C66;color:#FF3B5C;}.btn-red:hover{background:#FF3B5C30;border-color:#FF3B5C;}
.btn-purple{background:#B388FF18;border-color:#B388FF66;color:#B388FF;}.btn-purple:hover{background:#B388FF30;border-color:#B388FF;}
.btn-orange{background:#FF6D0018;border-color:#FF6D0066;color:#FF6D00;}.btn-orange:hover{background:#FF6D0030;border-color:#FF6D00;}
.btn-green{background:#00E67618;border-color:#00E67666;color:#00E676;}.btn-green:hover{background:#00E67630;border-color:#00E676;}
.btn-teal{background:#00BFA518;border-color:#00BFA566;color:#00BFA5;}.btn-teal:hover{background:#00BFA530;border-color:#00BFA5;}
.btn-ghost{background:transparent;border-color:#2A2F45;color:#8B90A0;}.btn-ghost:hover{border-color:#8B90A0;color:#E8EAED;}
.btn:disabled{opacity:0.35;cursor:not-allowed;pointer-events:none;}
.card{background:#111318;border:1px solid #2A2F45;border-radius:10px;padding:18px;transition:border-color 0.2s;}
.card-hi{border-color:#00E5FF44;background:#191C24;}.card-amber{border-color:#FFB30044;}.card-red{border-color:#FF3B5C44;}
.card-purple{border-color:#B388FF44;}.card-orange{border-color:#FF6D0044;}.card-green{border-color:#00E67644;}.card-teal{border-color:#00BFA544;}
.tag{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:100px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;}
.tag-cyan{background:#00E5FF18;color:#00E5FF;border:1px solid #00E5FF33;}.tag-amber{background:#FFB30018;color:#FFB300;border:1px solid #FFB30033;}
.tag-red{background:#FF3B5C18;color:#FF3B5C;border:1px solid #FF3B5C33;}.tag-green{background:#00E67618;color:#00E676;border:1px solid #00E67633;}
.tag-purple{background:#B388FF18;color:#B388FF;border:1px solid #B388FF33;}.tag-orange{background:#FF6D0018;color:#FF6D00;border:1px solid #FF6D0033;}
.tag-teal{background:#00BFA518;color:#00BFA5;border:1px solid #00BFA533;}.tag-muted{background:#22263A;color:#4A4F60;border:1px solid #2A2F45;}
.input{background:#191C24;border:1px solid #2A2F45;border-radius:6px;padding:9px 13px;color:#E8EAED;font-family:'Space Grotesk',sans-serif;font-size:14px;width:100%;outline:none;transition:border-color 0.15s;}
.input:focus{border-color:#00E5FF;box-shadow:0 0 0 3px #00E5FF15;}.input::placeholder{color:#4A4F60;}
select.input{cursor:pointer;}
textarea.input{resize:vertical;min-height:80px;}
.nav{position:sticky;top:0;z-index:100;background:#0A0B0Fee;backdrop-filter:blur(20px);border-bottom:1px solid #2A2F45;padding:10px 18px;display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;}
.modal-overlay{position:fixed;inset:0;background:#0A0B0Fcc;backdrop-filter:blur(8px);z-index:200;display:flex;align-items:center;justify-content:center;padding:16px;}
.modal{background:#111318;border:1px solid #2A2F45;border-radius:14px;padding:26px;max-width:660px;width:100%;max-height:90vh;overflow-y:auto;animation:fadeIn 0.2s ease;}
.modal-wide{max-width:880px;}
.player-chip{display:flex;align-items:center;gap:7px;padding:5px 10px;background:#191C24;border:1px solid #2A2F45;border-radius:20px;font-size:12px;}
.chat-bubble{padding:11px 14px;border-radius:10px;max-width:84%;font-size:13px;line-height:1.6;animation:fadeIn 0.3s ease;}
.chat-user{background:#00E5FF18;border:1px solid #00E5FF33;margin-left:auto;}
.chat-ai{background:#191C24;border:1px solid #2A2F45;}
.chat-system{background:#FFB30010;border:1px solid #FFB30022;color:#8B90A0;font-size:12px;text-align:center;max-width:100%;}
.chat-pressure{background:#FF3B5C10;border:1px solid #FF3B5C33;}
.chat-reverse{background:#B388FF10;border:1px solid #B388FF33;margin-right:auto;}
.chat-witness{background:#00BFA510;border:1px solid #00BFA533;}
.chat-error{background:#FF3B5C10;border:1px solid #FF3B5C44;color:#FF3B5C;font-size:12px;}
.chat-narrator{background:linear-gradient(135deg,#0A0B0F,#191C24);border:1px solid #B388FF44;color:#B388FF;font-style:italic;max-width:100%;text-align:center;}
.spinner{width:14px;height:14px;border:2px solid #2A2F45;border-top-color:#00E5FF;border-radius:50%;animation:spin 0.7s linear infinite;display:inline-block;}
.progress-track{height:4px;background:#22263A;border-radius:2px;overflow:hidden;}
.progress-fill{height:100%;background:linear-gradient(90deg,#00E5FF,#B388FF);border-radius:2px;transition:width 0.5s ease;}
.susp-track{height:8px;background:#22263A;border-radius:4px;overflow:hidden;}
.susp-fill{height:100%;border-radius:4px;transition:width 0.6s cubic-bezier(0.34,1.56,0.64,1);}
.section-label{font-family:'Space Mono',monospace;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#4A4F60;}
.logo-text{font-family:'Space Mono',monospace;font-size:17px;font-weight:700;letter-spacing:-0.02em;}
.logo-accent{color:#00E5FF;}
/* TIMER */
.timer-display{font-family:'Space Mono',monospace;font-size:22px;font-weight:700;letter-spacing:0.05em;}
.timer-critical{animation:timerPulse 0.8s ease infinite;color:#FF3B5C;}
/* NARRATOR */
.narrator-bar{background:linear-gradient(90deg,#0A0B0F,#1A1030,#0A0B0F);border-top:1px solid #B388FF33;border-bottom:1px solid #B388FF33;padding:12px 24px;text-align:center;font-style:italic;color:#B388FF;font-size:14px;line-height:1.7;}
/* MOOD BADGE */
.mood-badge{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;animation:moodPop 0.3s ease;}
/* FORENSICS */
.forensics-scanner{height:3px;background:linear-gradient(90deg,transparent,#00E5FF,transparent);animation:forensicsScan 1.5s ease infinite;border-radius:2px;}
/* ACCUSATION */
.accusation-card{border:2px solid transparent;border-radius:10px;padding:13px;cursor:pointer;background:#191C24;transition:all 0.2s;}
.accusation-card:hover{border-color:#FF3B5C66;}.accusation-card.selected{border-color:#FF3B5C;background:#FF3B5C10;}
.cross-tactic{border:2px solid transparent;border-radius:8px;padding:11px;cursor:pointer;background:#191C24;transition:all 0.2s;}
.cross-tactic:hover{border-color:#FF6D0066;}.cross-tactic.selected{border-color:#FF6D00;background:#FF6D0010;}
.witness-card{border:2px solid transparent;border-radius:10px;padding:13px;cursor:pointer;background:#191C24;transition:all 0.2s;}
.witness-card:hover{border-color:#00BFA566;}.witness-card.selected{border-color:#00BFA5;background:#00BFA510;}
.diff-card{border:2px solid transparent;border-radius:10px;padding:14px;cursor:pointer;background:#191C24;transition:all 0.2s;}
.diff-card:hover{border-color:#00E5FF44;}.diff-card.selected{border-color:#00E5FF;background:#00E5FF08;}
.model-row{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;cursor:pointer;border:1px solid #2A2F45;background:#191C24;transition:all 0.15s;}
.model-row:hover{border-color:#00E5FF44;}.model-row.active{border-color:#00E5FF;background:#00E5FF08;}
.pulse-red{animation:pulseRed 1.5s ease infinite;}
.pulse-amber{animation:pulseAmber 1.5s ease infinite;}
/* TUTORIAL TOOLTIP */
.tutorial-tip{background:linear-gradient(135deg,#0D1020,#1A1530);border:1px solid #B388FF55;border-radius:10px;padding:14px 16px;margin-bottom:14px;animation:slideUp 0.4s ease;}
/* API WARNING */
.api-warning{background:#FF3B5C12;border:1px solid #FF3B5C44;border-radius:8px;padding:12px 16px;display:flex;align-items:flex-start;gap:10px;}
/* LOG */
.log-panel{position:fixed;bottom:0;right:0;width:360px;max-height:250px;z-index:300;background:#0A0B0Ff5;border:1px solid #2A2F45;border-radius:10px 0 0 0;font-family:'Space Mono',monospace;font-size:11px;}
.log-header{padding:7px 12px;background:#191C24;border-bottom:1px solid #2A2F45;display:flex;justify-content:space-between;align-items:center;cursor:pointer;}
.log-scroll{overflow-y:auto;max-height:195px;padding:5px;}
.log-entry{padding:2px 5px;border-radius:3px;margin-bottom:2px;line-height:1.4;}
.log-DEBUG{color:#4A4F60;}.log-INFO{color:#00E5FF;}.log-WARN{color:#FFB300;}.log-ERROR{color:#FF3B5C;background:#FF3B5C10;}
`;

// ============================================================
// REUSABLE UI
// ============================================================
function LogPanel(){
  const [open,setOpen]=useState(false);
  const [logs,setLogs]=useState([]);
  const [filter,setFilter]=useState("ALL");
  const ref=useRef(null);
  useEffect(()=>{setLogs(logger.getLogs());return logger.onLog(e=>{if(e.type==="clear"){setLogs([]);return;}setLogs(p=>[...p.slice(-199),e]);});},[]);
  useEffect(()=>{if(open&&ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[logs,open]);
  const ec=logs.filter(l=>l.level==="ERROR").length,wc=logs.filter(l=>l.level==="WARN").length;
  const fil=filter==="ALL"?logs:logs.filter(l=>l.level===filter);
  return(
    <div className="log-panel">
      <div className="log-header" onClick={()=>setOpen(o=>!o)}>
        <span style={{color:T.textSec}}>DEV LOG{ec>0&&<span style={{color:T.red}}> ●{ec}E</span>}{wc>0&&<span style={{color:T.amber}}> ▲{wc}W</span>}</span>
        <div style={{display:"flex",gap:8}}>
          {open&&<span onClick={e=>{e.stopPropagation();const b=new Blob([logger.export()],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`cz-${Date.now()}.json`;a.click();}} style={{color:T.cyan,cursor:"pointer"}}>↓</span>}
          {open&&<span onClick={e=>{e.stopPropagation();logger.clear();}} style={{color:T.textMut,cursor:"pointer"}}>✕</span>}
          <span style={{color:T.textMut}}>{open?"▼":"▲"}</span>
        </div>
      </div>
      {open&&<>
        <div style={{display:"flex",gap:3,padding:"4px 6px",borderBottom:`1px solid ${T.border}`}}>
          {["ALL","DEBUG","INFO","WARN","ERROR"].map(f=><span key={f} onClick={()=>setFilter(f)} style={{cursor:"pointer",fontSize:10,padding:"2px 6px",borderRadius:3,background:filter===f?T.bg3:"transparent",color:filter===f?T.textPri:T.textMut}}>{f}</span>)}
        </div>
        <div ref={ref} className="log-scroll">
          {fil.length===0&&<div style={{color:T.textMut,padding:8}}>No logs.</div>}
          {fil.map(e=><div key={e.id} className={`log-entry log-${e.level}`}><span style={{color:T.textMut}}>{e.timestamp.slice(11,19)} [{e.category}] </span>{e.message}{e.data&&e.data!=="{}"&&<span style={{color:T.textMut,opacity:.7}}> {e.data.slice(0,70)}</span>}</div>)}
        </div>
      </>}
    </div>
  );
}

function SuspicionMeter({value,label="Suspicion"}){
  const p=Math.min(100,Math.max(0,value));
  const c=p<30?T.green:p<60?T.amber:p<80?T.orange:T.red;
  return(<div><div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span className="section-label">{label}</span><span style={{fontSize:11,fontFamily:"'Space Mono',monospace",color:c}}>{p<20?"CLEAR":p<40?"LOW":p<60?"MODERATE":p<80?"HIGH":"CRITICAL"} {p}%</span></div><div className="susp-track"><div className="susp-fill" style={{width:`${p}%`,background:`linear-gradient(90deg,${c}88,${c})`}}/></div></div>);
}
function LieMeter({value}){
  const p=Math.min(100,Math.max(0,value));
  const c=p<25?T.green:p<50?T.cyan:p<75?T.amber:T.red;
  return(<div><div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span className="section-label">Deception Analysis</span><span style={{fontSize:11,fontFamily:"'Space Mono',monospace",color:c}}>{p<25?"TRUTHFUL":p<50?"UNCERTAIN":p<75?"EVASIVE":"LYING"} {p}%</span></div><div className="susp-track"><div className="susp-fill" style={{width:`${p}%`,background:`linear-gradient(90deg,${T.green},${T.amber},${T.red})`}}/></div></div>);
}

// API KEY WARNING BANNER
function APIKeyWarning(){
  return(
    <div className="api-warning">
      <span style={{fontSize:20}}>⚠️</span>
      <div>
        <div style={{fontWeight:600,fontSize:13,color:T.red,marginBottom:3}}>No OpenAI API Key</div>
        <div style={{fontSize:12,color:T.textSec,lineHeight:1.5}}>AI features are disabled. Go to <strong style={{color:T.cyan}}>⚙ Settings</strong> and add your OpenAI key to enable interrogations, witness responses, lie detection, and the narrator.</div>
      </div>
    </div>
  );
}

// CASE TIMER
function CaseTimer({timerMinutes,onExpire,paused}){
  const totalSec=timerMinutes*60;
  const [remaining,setRemaining]=useState(totalSec);
  const [expired,setExpired]=useState(false);
  useEffect(()=>{
    if(timerMinutes===0||paused||expired)return;
    const id=setInterval(()=>setRemaining(r=>{
      if(r<=1){clearInterval(id);setExpired(true);onExpire&&onExpire();return 0;}
      return r-1;
    }),1000);
    return()=>clearInterval(id);
  },[timerMinutes,paused,expired]);
  if(timerMinutes===0)return null;
  const m=Math.floor(remaining/60),s=remaining%60;
  const pct=(remaining/totalSec)*100;
  const critical=remaining<120;
  const warn=remaining<300;
  const color=critical?T.red:warn?T.amber:T.green;
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,padding:"6px 14px",background:critical?`${T.red}15`:T.bg2,border:`1px solid ${critical?T.red:warn?T.amber:T.border}`,borderRadius:8,transition:"all 0.5s"}}>
      <span style={{fontSize:14}}>{critical?"🚨":warn?"⏳":"⏱"}</span>
      <div>
        <div className={`timer-display ${critical?"timer-critical":""}`} style={{color,fontSize:18}}>
          {String(m).padStart(2,"0")}:{String(s).padStart(2,"0")}
        </div>
        <div style={{width:80}} className="progress-track" ><div style={{height:"100%",background:color,borderRadius:2,transition:"width 1s linear",width:`${pct}%`}}/></div>
      </div>
    </div>
  );
}

// AI NARRATOR BAR
function NarratorBar({text,loading}){
  if(!text&&!loading)return null;
  return(
    <div className="narrator-bar anim-narrator">
      {loading?<span style={{display:"flex",alignItems:"center",justifyContent:"center",gap:10,color:T.purple}}><span className="spinner" style={{borderTopColor:T.purple}}/>Narrator composing...</span>
      :<>🎙 {text}</>}
    </div>
  );
}

// MOOD BADGE
function MoodBadge({suspectId,questionCount,guilty}){
  const mood=getMoodFromCount(questionCount,guilty);
  const m=MOODS[mood];
  return(
    <div className="mood-badge" style={{background:`${m.color}18`,border:`1px solid ${m.color}44`,color:m.color}}>
      <span>{m.icon}</span><span>{m.label}</span>
    </div>
  );
}

// TUTORIAL TIP
function TutorialTip({step,onDismiss}){
  if(!step)return null;
  return(
    <div className="tutorial-tip">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
        <div style={{display:"flex",gap:10,alignItems:"flex-start"}}>
          <span style={{fontSize:20,flexShrink:0}}>🎓</span>
          <div>
            <div style={{fontSize:12,color:T.purple,fontWeight:600,marginBottom:4}}>TUTORIAL — Game Master</div>
            <div style={{fontSize:13,color:T.textSec,lineHeight:1.6}}>{step.message}</div>
          </div>
        </div>
        <button className="btn btn-ghost" style={{padding:"3px 8px",fontSize:11,flexShrink:0}} onClick={onDismiss}>Got it</button>
      </div>
    </div>
  );
}

// ============================================================
// LANDING
// ============================================================
function LandingScreen({onStart}){
  return(
    <div style={{minHeight:"90vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24,textAlign:"center"}}>
      <div style={{marginBottom:14}}><span className="tag tag-cyan">v1.4 · 2026 EDITION</span></div>
      <h1 style={{fontSize:"clamp(38px,7vw,72px)",fontFamily:"'Space Mono',monospace",fontWeight:700,lineHeight:1.05,marginBottom:16,letterSpacing:"-0.03em"}}>CASE<span style={{color:T.cyan}}>ZERO</span></h1>
      <p style={{fontSize:15,color:T.textSec,maxWidth:500,lineHeight:1.8,marginBottom:36}}>Multiplayer detective mystery powered by OpenAI. Interrogate AI suspects. Read their moods. Race the clock. Solve the case.</p>
      <div style={{display:"flex",gap:12,flexWrap:"wrap",justifyContent:"center",marginBottom:20}}>
        <button className="btn btn-cyan" style={{fontSize:16,padding:"14px 32px"}} onClick={()=>onStart("lobby")}>▶ Start Game</button>
        <button className="btn btn-green" style={{fontSize:15,padding:"14px 24px"}} onClick={()=>onStart("tutorial")}>🎓 Tutorial</button>
        <button className="btn btn-ghost" onClick={()=>onStart("settings")}>⚙ Settings</button>
      </div>
      <div style={{marginTop:36,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(145px,1fr))",gap:9,maxWidth:720,width:"100%"}}>
        {[["🔍","Detective Mode"],["💬","AI Interrogation"],["🧬","Suspect Moods"],["🔄","Dynamic Alibis"],["👁","Witness System"],["⚔","Cross-Examine"],["⏱","Case Timer"],["🔬","Forensics Lab"],["🎙","AI Narrator"],["🎯","Reverse Grill"],["📱","Mobile Companion"],["🎓","Tutorial Mode"]].map(([icon,title])=>(
          <div key={title} style={{padding:"11px",background:T.bg1,border:`1px solid ${T.border}`,borderRadius:8,textAlign:"left"}}>
            <div style={{fontSize:18,marginBottom:5}}>{icon}</div>
            <div style={{fontSize:11,fontWeight:600}}>{title}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SETTINGS
// ============================================================
function SettingsScreen({settings,onChange,onBack}){
  const [testStatus,setTestStatus]=useState("");
  const [testing,setTesting]=useState(false);
  const test=async()=>{
    setTesting(true);setTestStatus("");
    const r=await callAI("Reply with exactly the words: Connection OK","Reply with: Connection OK","test",settings);
    setTestStatus(isAIError(r)?`❌ ${r.replace(AI_ERROR_PREFIX,"").trim()}`:"✅ Connected — AI working");
    setTesting(false);
  };
  return(
    <div style={{maxWidth:640,margin:"0 auto",padding:24}}>
      <button className="btn btn-ghost" style={{marginBottom:22}} onClick={onBack}>← Back</button>
      <h2 style={{fontFamily:"'Space Mono',monospace",marginBottom:4}}>Settings</h2>
      <p style={{color:T.textSec,marginBottom:26,fontSize:14}}>Configure OpenAI, model, voices, and options.</p>
      {!settings.openaiKey&&<div style={{marginBottom:16}}><APIKeyWarning/></div>}
      <div className="card" style={{marginBottom:14}}>
        <div className="section-label" style={{marginBottom:12}}>OpenAI API Key</div>
        <input className="input" type="password" placeholder="sk-..." value={settings.openaiKey||""} onChange={e=>onChange({...settings,openaiKey:e.target.value})} style={{marginBottom:14}}/>
        <div className="section-label" style={{marginBottom:10}}>Model</div>
        <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:14}}>
          {OPENAI_MODELS.map(m=>(
            <div key={m.id} className={`model-row ${settings.openaiModel===m.id?"active":""}`} onClick={()=>onChange({...settings,openaiModel:m.id})}>
              <div style={{width:8,height:8,borderRadius:"50%",background:m.tier==="advanced"?T.purple:m.tier==="fast"?T.green:T.cyan,flexShrink:0}}/>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:settings.openaiModel===m.id?T.cyan:T.textPri}}>{m.label}</div><div style={{fontSize:11,color:T.textSec}}>{m.desc}</div></div>
              <span className={`tag tag-${m.tier==="advanced"?"purple":m.tier==="fast"?"green":"cyan"}`} style={{fontSize:9}}>{m.tier}</span>
              {settings.openaiModel===m.id&&<span style={{color:T.cyan}}>✓</span>}
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
          <button className="btn btn-ghost" style={{fontSize:12,padding:"6px 14px"}} onClick={test} disabled={testing}>{testing?<><span className="spinner"/>Testing...</>:"🔌 Test Connection"}</button>
          {testStatus&&<span style={{fontSize:12,color:testStatus.startsWith("✅")?T.green:T.red}}>{testStatus}</span>}
        </div>
      </div>
      <div className="card" style={{marginBottom:14}}>
        <div className="section-label" style={{marginBottom:10}}>ElevenLabs Voice (Optional)</div>
        <input className="input" placeholder="ElevenLabs API Key" value={settings.elevenLabsKey||""} onChange={e=>onChange({...settings,elevenLabsKey:e.target.value})} style={{marginBottom:8}}/>
        <input className="input" placeholder="Voice ID" value={settings.elevenLabsVoiceId||""} onChange={e=>onChange({...settings,elevenLabsVoiceId:e.target.value})}/>
      </div>
      <div className="card">
        <div className="section-label" style={{marginBottom:14}}>Options</div>
        {[{k:"aiHints",l:"AI Hint System"},{k:"voiceEnabled",l:"Voice (ElevenLabs)"},{k:"lieDetector",l:"AI Lie Detector"},{k:"narratorEnabled",l:"AI Noir Narrator"},{k:"showDevLog",l:"Dev Log Panel"}].map(o=>(
          <label key={o.k} style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:16,marginBottom:14,cursor:"pointer"}}>
            <span style={{fontSize:14,fontWeight:500}}>{o.l}</span>
            <div onClick={()=>onChange({...settings,[o.k]:!settings[o.k]})} style={{width:42,height:24,borderRadius:12,cursor:"pointer",transition:"all 0.2s",background:settings[o.k]?T.cyan:T.bg3,border:`1px solid ${settings[o.k]?T.cyan:T.border}`,position:"relative",flexShrink:0}}>
              <div style={{width:18,height:18,borderRadius:"50%",background:"white",position:"absolute",top:2,transition:"left 0.2s",left:settings[o.k]?20:2}}/>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// LOBBY
// ============================================================
function LobbyScreen({settings,onGameStart,onBack}){
  const [players,setPlayers]=useState([{id:1,name:"Detective 1",color:PLAYER_COLORS[0]}]);
  const [selCase,setSelCase]=useState(BUILT_IN_CASES[0]);
  const [mode,setMode]=useState("combined");
  const [difficulty,setDifficulty]=useState("medium");
  const [timerOverride,setTimerOverride]=useState(-1); // -1 = use diff default
  const [newName,setNewName]=useState("");
  const [gen,setGen]=useState(false);
  const [showCustom,setShowCustom]=useState(false);
  const [customPrompt,setCustomPrompt]=useState("");
  const [genErr,setGenErr]=useState("");

  const addPlayer=()=>{if(players.length>=8)return;const name=newName.trim()||`Detective ${players.length+1}`;setPlayers(p=>[...p,{id:Date.now(),name,color:PLAYER_COLORS[p.length%8]}]);setNewName("");};

  const generateCase=async()=>{
    setGen(true);setGenErr("");
    const prompt=`Create a detective mystery. Return ONLY valid compact JSON, no markdown, no explanation:
{"id":"c${Date.now()}","title":"Title","setting":"Setting","summary":"One-sentence hook","victim":"Name, age, role","cause":"Method","killer":"Exact suspect name","killerReason":"2-sentence motive","narratorIntro":"1-2 sentence noir atmosphere intro","suspects":[{"id":"s1","name":"Name","role":"Role","age":35,"alibi":"Alibi","secret":"Secret","guilty":false,"dossier":{"background":"","knownAssociates":"","priorRecord":"","financials":""},"timeline":[{"time":"9pm","action":"Action"}]},{"id":"s2","name":"Name","role":"Role","age":40,"alibi":"Alibi","secret":"Secret","guilty":true,"dossier":{"background":"","knownAssociates":"","priorRecord":"","financials":""},"timeline":[]},{"id":"s3","name":"Name","role":"Role","age":45,"alibi":"Alibi","secret":"Secret","guilty":false,"dossier":{"background":"","knownAssociates":"","priorRecord":"","financials":""},"timeline":[]},{"id":"s4","name":"Name","role":"Role","age":50,"alibi":"Alibi","secret":"Secret","guilty":false,"dossier":{"background":"","knownAssociates":"","priorRecord":"","financials":""},"timeline":[]}],"clues":[{"id":"c1","name":"Clue","description":"Detail","found":false,"critical":true,"room":"Room A"},{"id":"c2","name":"Clue","description":"Detail","found":false,"critical":true,"room":"Room B"},{"id":"c3","name":"Clue","description":"Detail","found":false,"critical":false,"room":"Room A"},{"id":"c4","name":"Clue","description":"Detail","found":false,"critical":false,"room":"Room C"},{"id":"c5","name":"Clue","description":"Detail","found":false,"critical":false,"room":"Room B"}],"rooms":["Room A","Room B","Room C"],"witnesses":[{"id":"w1","name":"Name","role":"Role","avatar":"👤","summary":"One line","statements":[{"trigger":"general","text":"Opening statement"},{"trigger":"suspicious","text":"Something suspicious"}]}],"interrogationQuestions":{"s1":[{"q":"Q?"}],"s2":[{"q":"Q?"}]},"reverseInterrogation":{"detective_alibi":"Claim","detective_secret":"Vulnerability","ai_questions":["Q1?","Q2?","Q3?"]},"crossExam":{"s2":{"contradiction":"Contradiction","pressure_point":"Key point","crack_threshold":2}}}
Theme: ${customPrompt||"Dramatic murder at a private members club"}`;
    const raw=await callAI(prompt,"Return ONLY valid compact JSON. No markdown. No extra text.","case-gen",settings);
    if(isAIError(raw)){setGenErr(raw.replace(AI_ERROR_PREFIX,"").trim());setGen(false);return;}
    const parsed=safeParseJSON(raw);
    if(parsed._error||parsed._parseError){setGenErr(parsed._error||"JSON parse failed: "+parsed._raw?.slice(0,80));setGen(false);return;}
    parsed.suspects.forEach(s=>{s.dossier=s.dossier||{background:"",knownAssociates:"",priorRecord:"None",financials:""};s.timeline=s.timeline||[];});
    parsed.witnesses=parsed.witnesses||[];
    parsed.reverseInterrogation=parsed.reverseInterrogation||{detective_alibi:"Called in after the fact",detective_secret:"Unknown connection",ai_questions:["Where were you?","Who do you know here?","Why this case?"]};
    parsed.crossExam=parsed.crossExam||{};
    setSelCase(parsed);setShowCustom(false);
    logger.info("LOBBY",`AI case generated: ${parsed.title}`);
    setGen(false);
  };

  const diff=DIFFICULTY[difficulty];
  const timerMins=timerOverride>=0?timerOverride:diff.timerMinutes;

  return(
    <div style={{maxWidth:940,margin:"0 auto",padding:24}}>
      <button className="btn btn-ghost" style={{marginBottom:22}} onClick={onBack}>← Back</button>
      <h2 style={{fontFamily:"'Space Mono',monospace",marginBottom:4}}>Mission Briefing</h2>
      <p style={{color:T.textSec,marginBottom:26,fontSize:14}}>Set your team, difficulty, and case.</p>
      {!settings.openaiKey&&<div style={{marginBottom:20}}><APIKeyWarning/></div>}

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div className="card">
          <div className="section-label" style={{marginBottom:12}}>Detectives ({players.length}/8)</div>
          <div style={{display:"flex",flexDirection:"column",gap:7,marginBottom:12}}>
            {players.map(p=>(
              <div key={p.id} style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:9,height:9,borderRadius:"50%",background:p.color,flexShrink:0}}/>
                <span style={{flex:1,fontSize:13}}>{p.name}</span>
                {players.length>1&&<button className="btn btn-ghost" style={{padding:"2px 7px",fontSize:11}} onClick={()=>setPlayers(pl=>pl.filter(x=>x.id!==p.id))}>✕</button>}
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <input className="input" placeholder="Player name" value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addPlayer()} style={{flex:1}}/>
            <button className="btn btn-cyan" onClick={addPlayer} disabled={players.length>=8}>+</button>
          </div>
        </div>
        <div className="card">
          <div className="section-label" style={{marginBottom:12}}>Game Mode</div>
          {[{id:"detective",icon:"🔍",l:"Detective Mode",d:"Explore rooms, find clues"},{id:"interrogation",icon:"💬",l:"Interrogation",d:"AI suspects + Witnesses + Cross-Exam"},{id:"combined",icon:"🗂",l:"Full Investigation ★",d:"Everything — detect, interrogate, forensics, grill"}].map(m=>(
            <div key={m.id} onClick={()=>setMode(m.id)} style={{padding:"9px 12px",borderRadius:8,cursor:"pointer",marginBottom:7,border:`1px solid ${mode===m.id?T.cyan:T.border}`,background:mode===m.id?`${T.cyan}10`:T.bg2,transition:"all 0.15s"}}>
              <div style={{display:"flex",alignItems:"center",gap:9}}><span>{m.icon}</span><div><div style={{fontSize:13,fontWeight:600,color:mode===m.id?T.cyan:T.textPri}}>{m.l}</div><div style={{fontSize:11,color:T.textSec}}>{m.d}</div></div></div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="section-label" style={{marginBottom:12}}>Difficulty</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10}}>
          {Object.values(DIFFICULTY).map(d=>(
            <div key={d.id} className={`diff-card ${difficulty===d.id?"selected":""}`} onClick={()=>setDifficulty(d.id)}>
              <div style={{fontSize:20,marginBottom:5}}>{d.icon}</div>
              <div style={{fontSize:13,fontWeight:600,color:difficulty===d.id?T.cyan:T.textPri,marginBottom:4}}>{d.label}</div>
              <div style={{fontSize:11,color:T.textSec,lineHeight:1.5}}>{d.desc}</div>
              {d.permadeath&&<span className="tag tag-red" style={{fontSize:9,marginTop:8}}>PERMADEATH</span>}
            </div>
          ))}
        </div>
        <div style={{marginTop:14}}>
          <div className="section-label" style={{marginBottom:8}}>Case Timer Override</div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {TIMER_OPTIONS.map(t=>(
              <button key={t.v} className={`btn ${timerOverride===t.v?"btn-cyan":"btn-ghost"}`} style={{padding:"5px 12px",fontSize:12}} onClick={()=>setTimerOverride(t.v)}>
                {t.l}{t.v>0&&t.v===diff.timerMinutes?" (default)":""}
              </button>
            ))}
          </div>
          <div style={{fontSize:11,color:T.textMut,marginTop:6}}>Timer: {timerMins===0?"Off":`${timerMins} minutes`} — killer escapes when time runs out</div>
        </div>
      </div>

      <div className="card" style={{marginBottom:16}}>
        <div className="section-label" style={{marginBottom:12}}>Select Case</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(175px,1fr))",gap:9,marginBottom:12}}>
          {BUILT_IN_CASES.map(c=>(
            <div key={c.id} onClick={()=>setSelCase(c)} style={{padding:"11px 13px",borderRadius:8,cursor:"pointer",border:`1px solid ${selCase?.id===c.id?T.amber:T.border}`,background:selCase?.id===c.id?`${T.amber}10`:T.bg2,transition:"all 0.15s"}}>
              <div style={{fontSize:13,fontWeight:600,color:selCase?.id===c.id?T.amber:T.textPri,marginBottom:3}}>{c.title}</div>
              <div style={{fontSize:11,color:T.textSec}}>{c.setting}</div>
            </div>
          ))}
          <div onClick={()=>setShowCustom(true)} style={{padding:"11px 13px",borderRadius:8,cursor:"pointer",border:`1px dashed ${T.border}`,background:T.bg2,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <span style={{color:T.textMut,fontSize:13}}>+ AI Generate</span>
          </div>
        </div>
        {selCase&&<div style={{padding:"11px 13px",background:T.bg2,borderRadius:8,border:`1px solid ${T.border}`}}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:3}}>{selCase.title}</div>
          <div style={{fontSize:13,color:T.textSec,marginBottom:8}}>{selCase.summary}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <span className="tag tag-muted">{selCase.suspects?.length} suspects</span>
            <span className="tag tag-muted">{selCase.clues?.length} clues</span>
            <span className="tag tag-teal">{selCase.witnesses?.length||0} witnesses</span>
          </div>
        </div>}
      </div>

      <button className="btn btn-cyan" style={{width:"100%",justifyContent:"center",fontSize:15,padding:"14px"}} disabled={!selCase}
        onClick={()=>onGameStart({players,caseData:selCase,gameMode:mode,difficulty,timerMinutes:timerMins})}>
        ▶ Begin Investigation
      </button>

      {showCustom&&(
        <div className="modal-overlay" onClick={()=>setShowCustom(false)}>
          <div className="modal" onClick={e=>e.stopPropagation()}>
            <h3 style={{fontFamily:"'Space Mono',monospace",marginBottom:8}}>AI Case Generator</h3>
            <p style={{color:T.textSec,fontSize:13,marginBottom:14}}>Describe the theme. GPT builds the full mystery.</p>
            <textarea className="input" placeholder="e.g. 'Spy thriller on 1940s Orient Express' or 'Cozy Christmas village'" value={customPrompt} onChange={e=>setCustomPrompt(e.target.value)} style={{marginBottom:12}}/>
            {genErr&&<div style={{color:T.red,fontSize:12,marginBottom:10,padding:"8px 10px",background:`${T.red}10`,borderRadius:6}}>❌ {genErr}</div>}
            <div style={{display:"flex",gap:10}}>
              <button className="btn btn-cyan" onClick={generateCase} disabled={gen||!settings.openaiKey} style={{flex:1}}>{gen?<><span className="spinner"/>Generating...</>:"✨ Generate"}</button>
              <button className="btn btn-ghost" onClick={()=>setShowCustom(false)}>Cancel</button>
            </div>
            {!settings.openaiKey&&<div style={{fontSize:11,color:T.amber,marginTop:8}}>⚠ Add your OpenAI key in Settings first.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// TUTORIAL WRAPPER
// ============================================================
function TutorialWrapper({settings,onDone}){
  return(
    <GameScreen
      gameState={{players:[{id:1,name:"Trainee Detective",color:PLAYER_COLORS[0]}],caseData:TUTORIAL_CASE,gameMode:"combined",difficulty:"easy",timerMinutes:0}}
      settings={settings}
      onEnd={onDone}
      isTutorial={true}
    />
  );
}

// ============================================================
// MAIN GAME SCREEN
// ============================================================
function GameScreen({gameState,settings,onEnd,isTutorial=false}){
  const {players,caseData,gameMode,difficulty,timerMinutes}=gameState;
  const diff=DIFFICULTY[difficulty]||DIFFICULTY.medium;
  const [phase,setPhase]=useState(gameMode==="interrogation"?"interrogation":"detective");
  const [curPlayer,setCurPlayer]=useState(0);
  const [clues,setClues]=useState(()=>{
    let c=caseData.clues.map(x=>({...x}));
    if(diff.freeClues>0){let g=0;c=c.map(x=>{if(!x.found&&x.critical&&g<diff.freeClues){g++;return{...x,found:true};}return x;});}
    return c;
  });
  const [notes,setNotes]=useState({});
  const [selSuspect,setSelSuspect]=useState(null);
  const [interrogHist,setInterrogHist]=useState({});
  const [questionCounts,setQuestionCounts]=useState({}); // suspectId -> count for mood
  const [dynamicAlibis,setDynamicAlibis]=useState({}); // suspectId -> updated alibi string
  const [lieScores,setLieScores]=useState({});
  const [crossState,setCrossState]=useState({});
  const [witnessState,setWitnessState]=useState({});
  const [forensicsState,setForensicsState]=useState({}); // clueId -> {loading,report}
  const [forensicsUsed,setForensicsUsed]=useState(false);
  const [customQ,setCustomQ]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [accusation,setAccusation]=useState(null);
  const [verdict,setVerdict]=useState(null);
  const [activeRoom,setActiveRoom]=useState(caseData.rooms[0]);
  const [hint,setHint]=useState("");const [hintUsed,setHintUsed]=useState(false);const [showHint,setShowHint]=useState(false);
  const [showAccuse,setShowAccuse]=useState(false);
  const [showReverse,setShowReverse]=useState(false);
  const [revState,setRevState]=useState({suspicion:15,history:[],qIdx:0,ans:"",loading:false,done:false,error:""});
  const [showDossier,setShowDossier]=useState(null);
  const [showTimeline,setShowTimeline]=useState(null);
  const [showMobile,setShowMobile]=useState(false);
  const [subTab,setSubTab]=useState("interrogate");
  const [teamVotes,setTeamVotes]=useState({});
  const [showVote,setShowVote]=useState(false);
  const [narrator,setNarrator]=useState({text:caseData.narratorIntro||"",loading:false});
  const [timerExpired,setTimerExpired]=useState(false);
  const [tutorialStep,setTutorialStep]=useState(isTutorial?0:-1);
  const chatRef=useRef(null);
  const player=players[curPlayer];
  const foundClues=clues.filter(c=>c.found);
  const progress=Math.round((foundClues.length/clues.length)*100);

  useEffect(()=>{logger.info("GAME","Mounted",{case:caseData.id,diff:difficulty,timer:timerMinutes,model:settings.openaiModel});},[]);
  useEffect(()=>{if(chatRef.current)chatRef.current.scrollTop=chatRef.current.scrollHeight;},[interrogHist,selSuspect,subTab,revState.history,witnessState]);

  // Auto-show narrator on phase change
  useEffect(()=>{
    if(!settings.narratorEnabled||!settings.openaiKey)return;
    triggerNarrator(phase);
  },[phase]);

  const triggerNarrator=async(ph)=>{
    if(!settings.narratorEnabled||!settings.openaiKey)return;
    setNarrator(n=>({...n,loading:true}));
    const fc=clues.filter(c=>c.found).map(c=>c.name).join(", ")||"nothing yet";
    const sys="You are a hardboiled noir narrator for a detective game. One atmospheric sentence, 15-25 words, present tense. No quotes. No em-dashes. Evocative and tense.";
    const pr=`Case: ${caseData.title}. Phase: ${ph}. Clues found: ${fc}. Write one atmospheric narrator line.`;
    const txt=await callAI(pr,sys,"narrator",settings);
    setNarrator({text:isAIError(txt)?"The investigation continues...":txt,loading:false});
  };

  const discoverClue=async(c)=>{
    logger.info("CLUE",`Found: ${c.name}`,{critical:c.critical});
    setClues(prev=>prev.map(x=>x.id===c.id?{...x,found:true}:x));
    if(isTutorial&&tutorialStep===0&&c.critical)advanceTutorial(1);
  };

  // FORENSICS LAB
  const runForensics=async(clue)=>{
    if(forensicsState[clue.id]?.report)return;
    const cost=forensicsUsed; // first is free
    logger.info("FORENSICS",`Analyzing: ${clue.name}`,{free:!cost});
    setForensicsState(p=>({...p,[clue.id]:{loading:true,report:null,error:""}}));
    const sys="You are a forensic scientist writing a brief lab report. 3-4 sentences. Provide specific scientific detail that adds new information to the clue. Include one unexpected additional finding that could help or mislead the detective.";
    const pr=`Clue: "${clue.name}" — ${clue.description}. Case: ${caseData.title}. Write a forensic lab report with an additional finding.`;
    const txt=await callAI(pr,sys,`forensics-${clue.id}`,settings);
    if(isAIError(txt)){setForensicsState(p=>({...p,[clue.id]:{loading:false,report:null,error:txt.replace(AI_ERROR_PREFIX,"").trim()}}));return;}
    setForensicsState(p=>({...p,[clue.id]:{loading:false,report:txt,error:""}}));
    setForensicsUsed(true);
    logger.info("FORENSICS","Report complete",{clueId:clue.id});
  };

  // INTERROGATION + MOOD + DYNAMIC ALIBI
  const askSuspect=async(suspect,question)=>{
    if(!settings.openaiKey){logger.warn("INTERROG","No key");return;}
    logger.info("INTERROG",`${player.name} → ${suspect.name}`,{q:question.slice(0,60)});
    setAiLoading(true);
    const qCount=(questionCounts[suspect.id]||0)+1;
    setQuestionCounts(p=>({...p,[suspect.id]:qCount}));
    const mood=getMoodFromCount(qCount-1,suspect.guilty);
    const moodDesc=MOODS[mood].desc;
    const currentAlibi=dynamicAlibis[suspect.id]||suspect.alibi;
    const foundTxt=foundClues.map(c=>`- ${c.name}: ${c.description}`).join("\n")||"none";
    const sys=`You are ${suspect.name}, ${suspect.role}, age ${suspect.age}. Case: "${caseData.title}".
Victim: ${caseData.victim}. Current alibi: "${currentAlibi}". Hidden secret: "${suspect.secret}".
Guilty: ${suspect.guilty?"YES — deny convincingly, show subtle cracks under pressure.":"NO — innocent but nervous, hide your secret."}.
Current mood: ${mood} — ${moodDesc}.
Evidence the detective has found: ${foundTxt}.
Clues found count: ${foundClues.length}. Question number to you: ${qCount}.
MOOD BEHAVIOR: ${mood==="cooperative"?"Be open, give extra details, maybe too much.":mood==="nervous"?"Be shaky, contradict yourself slightly, fidget.":mood==="defensive"?"Keep answers short, deflect, turn questions back on them.":"Be curt, hostile, threaten to end the interview."}
Reply in 2-3 sentences. Human, realistic, emotionally consistent with mood.`;
    const resp=await callAI(`Detective asks: "${question}"`,sys,`interrogate-${suspect.id}`,settings);

    // Lie detector — only run if main call succeeded
    let lieScore=null;
    if(!isAIError(resp)&&(settings.lieDetector||diff.lieDetectorForce)){
      const lsys="You are a deception analyst. Return ONLY JSON: {\"score\":45} where score 0-100 measures deception likelihood. 100=definitely lying. Base on evasiveness, inconsistency, emotional deflection.";
      const lraw=await callAI(`Suspect: ${suspect.name}. Guilty: ${suspect.guilty}. Mood: ${mood}. Q: "${question}". A: "${resp}"`,lsys,"lie-detect",settings);
      if(!isAIError(lraw)){
        const lp=safeParseJSON(lraw,{score:50});
        if(!lp._error&&!lp._parseError){lieScore=Math.min(100,Math.max(0,Number(lp.score)||50));setLieScores(p=>({...p,[suspect.id]:lieScore}));logger.info("LIE",`${suspect.name}: ${lieScore}%`);}
        else logger.warn("LIE","Parse fail",{raw:lraw.slice(0,80)});
      } else logger.warn("LIE",`AI error: ${lraw.slice(0,60)}`);
    }

    const entry={q:question,a:resp,player:player.name,lieScore,mood,isError:isAIError(resp)};
    setInterrogHist(p=>({...p,[suspect.id]:[...(p[suspect.id]||[]),entry]}));
    setCustomQ("");
    if(!isAIError(resp))await speakText(resp,settings);
    if(isTutorial&&tutorialStep===2)advanceTutorial(3);
    setAiLoading(false);
  };

  // CROSS-EXAM + DYNAMIC ALIBI UPDATE
  const doCrossExam=async(suspect,tactic)=>{
    setAiLoading(true);
    const examData=caseData.crossExam?.[suspect.id];
    const state=crossState[suspect.id]||{round:0,cracked:false,history:[]};
    const newRound=state.round+1;
    const threshold=Math.max(1,Math.round((examData?.crack_threshold||2)*diff.crackMultiplier));
    const willCrack=newRound>=threshold&&suspect.guilty;
    const currentAlibi=dynamicAlibis[suspect.id]||suspect.alibi;
    const sys=`You are ${suspect.name} being pressed with a contradiction.
Current alibi (may have already shifted): "${currentAlibi}".
The contradiction being pressed: "${examData?.contradiction||"Your alibi doesn't add up."}".
Pressure point: "${examData?.pressure_point||"key evidence"}".
Guilty: ${suspect.guilty?"YES":"NO"}. Round ${newRound}/${threshold}.
${willCrack?"BREAKING POINT — show a dramatic crack, near-confession, emotional breakdown, or devastating slip. Very tense.":"Hold firm but fracture subtly. Consider slightly adjusting your alibi to cover a gap — shift your story just enough to seem like you forgot a detail."}
2-3 sentences. Very human, very tense.`;
    const resp=await callAI(`Tactic "${tactic}" pressed against: "${examData?.contradiction}"`,sys,`cross-${suspect.id}`,settings);
    if(isAIError(resp)){setCrossState(p=>({...p,[suspect.id]:{...state,history:[...state.history,{tactic,response:resp,round:newRound,cracked:false,isError:true}]}}));setAiLoading(false);return;}

    // DYNAMIC ALIBI — if suspect shifts story, update their alibi
    if(!willCrack&&newRound>1){
      const asys="You are tracking a suspect's shifting alibi. Given their latest response, extract their NEW claimed alibi in one sentence. If unchanged, return the original. Return ONLY the alibi sentence, nothing else.";
      const newAlibiRaw=await callAI(`Original alibi: "${currentAlibi}". Latest response: "${resp}"`,asys,"dynamic-alibi",settings);
      if(!isAIError(newAlibiRaw)&&newAlibiRaw.length>10&&newAlibiRaw.length<200){
        setDynamicAlibis(p=>({...p,[suspect.id]:newAlibiRaw}));
        logger.info("ALIBI",`${suspect.name} alibi updated`,{new:newAlibiRaw.slice(0,60)});
      }
    }

    const newH=[...state.history,{tactic,response:resp,round:newRound,cracked:willCrack}];
    setCrossState(p=>({...p,[suspect.id]:{round:newRound,cracked:willCrack||state.cracked,history:newH}}));
    await speakText(resp,settings);
    if(isTutorial&&tutorialStep===3)advanceTutorial(4);
    setAiLoading(false);
  };

  // WITNESS
  const callWitness=async(witness,trigger="general")=>{
    setAiLoading(true);
    const preset=witness.statements?.find(s=>s.trigger===trigger)||witness.statements?.[0];
    const existing=witnessState[witness.id]||{chatHistory:[]};
    let response;
    if(preset&&existing.chatHistory.length<2&&!settings.openaiKey){
      response=preset.text;
    } else if(preset&&existing.chatHistory.length<2){
      response=preset.text; // use scripted first
    } else {
      const sys=`You are ${witness.name}, ${witness.role}. Case: "${caseData.title}". ${witness.summary}.
Prior scripted statements: ${witness.statements?.map(s=>s.text).join(" ")||"none"}.
Prior answers: ${existing.chatHistory.map(h=>h.response).join(" | ")||"none"}.
Give a natural 2-3 sentence follow-up about: ${trigger}. Stay consistent. If unsure, say so.`;
      response=await callAI(`Witness asked about: "${trigger}"`,sys,`witness-${witness.id}`,settings);
    }
    const newEntry={trigger,response:isAIError(response)?`[Witness unavailable: ${response.replace(AI_ERROR_PREFIX,"")}]`:response,player:player.name};
    setWitnessState(p=>({...p,[witness.id]:{unlocked:true,chatHistory:[...(p[witness.id]?.chatHistory||[]),newEntry]}}));
    if(!isAIError(response))await speakText(response,settings);
    if(isTutorial&&tutorialStep===4)advanceTutorial(5);
    setAiLoading(false);
  };

  const askWitnessCustom=async(witness,question)=>{
    if(!question.trim())return;
    setAiLoading(true);
    const existing=witnessState[witness.id]||{chatHistory:[]};
    const sys=`You are ${witness.name}, ${witness.role}. Case: "${caseData.title}". ${witness.summary}.
Known info: ${witness.statements?.map(s=>s.text).join(" ")||"none"}.
Prior answers: ${existing.chatHistory.map(h=>h.response).join(" | ")||"none"}.
Reply honestly 2-3 sentences. Stay consistent.`;
    const resp=await callAI(`Detective asks: "${question}"`,sys,`witness-custom-${witness.id}`,settings);
    const entry={trigger:"custom",question,response:isAIError(resp)?`[${resp.replace(AI_ERROR_PREFIX,"")}]`:resp,player:player.name};
    setWitnessState(p=>({...p,[witness.id]:{...(p[witness.id]||{unlocked:true}),chatHistory:[...(p[witness.id]?.chatHistory||[]),entry]}}));
    if(!isAIError(resp))await speakText(resp,settings);
    setAiLoading(false);
  };

  // REVERSE INTERROGATION
  const submitRevAnswer=async()=>{
    const ri=caseData.reverseInterrogation;
    const qList=ri?.ai_questions?.slice(0,diff.reverseQuestions)||[];
    const q=qList[revState.qIdx];
    const ans=revState.ans.trim();
    if(!ans)return;
    if(!settings.openaiKey){setRevState(s=>({...s,error:"No OpenAI key. Add it in Settings to use reverse interrogation.",loading:false}));return;}
    setRevState(s=>({...s,loading:true,error:""}));
    const sys=`You are a hard-boiled detective inspector grilling Detective ${player.name}.
Their alibi: "${ri.detective_alibi}". Their vulnerability: "${ri.detective_secret}".
Be adversarial, skeptical, persistent. Rate their answer believability 1-10.
Return ONLY valid JSON: {"score":7,"response":"2-3 sentence reaction."}
Do NOT add any text outside the JSON.`;
    const raw=await callAI(`Question: "${q}"\nDetective's answer: "${ans}"`,sys,"reverse",settings);
    if(isAIError(raw)){setRevState(s=>({...s,loading:false,error:raw.replace(AI_ERROR_PREFIX,"").trim()}));return;}
    const parsed=safeParseJSON(raw,{score:5,response:"...your answer is noted."});
    if(parsed._error){setRevState(s=>({...s,loading:false,error:`AI response error: ${parsed._error}`}));return;}
    const score=Math.min(10,Math.max(1,Number(parsed.score)||5));
    const aiResp=parsed.response||"...your answer is noted.";
    const delta=score>=7?-(Math.floor(Math.random()*15)+5):score>=4?Math.floor(Math.random()*8):Math.floor(Math.random()*20)+8;
    const newSusp=Math.min(100,Math.max(0,revState.suspicion+delta));
    const isDone=revState.qIdx>=qList.length-1;
    setRevState(s=>({...s,loading:false,error:"",history:[...s.history,{q,a:ans,aiResp,score,delta}],suspicion:newSusp,qIdx:s.qIdx+1,ans:"",done:isDone}));
    await speakText(aiResp,settings);
    logger.info("REVERSE",`Q${revState.qIdx+1} score:${score} susp:${newSusp}`);
  };

  const getHint=async()=>{
    if(!diff.unlimitedHints&&hintUsed)return;
    setAiLoading(true);
    const h=await callAI(`Detective found: ${foundClues.map(c=>c.name).join(",")||"nothing"}. One cryptic noir hint ≤20 words pointing toward the next critical clue.`,"You are the AI game master. Subtle, cryptic, noir-style hints.","hint",settings);
    setHint(isAIError(h)?"Look closer at what's already in front of you.":h);
    setHintUsed(true);setShowHint(true);setAiLoading(false);
  };

  const submitAccusation=()=>{
    const s=caseData.suspects.find(x=>x.id===accusation);
    if(diff.permadeath&&!s.guilty){logger.warn("GAME","Hard permadeath wrong accusation");setVerdict({correct:false,suspect:s,killer:caseData.suspects.find(x=>x.guilty),reason:caseData.killerReason,foundClues,revSuspicion:revState.suspicion,players,teamVotes,permadeath:true});setShowAccuse(false);return;}
    logger.info("ACCUSE",`${player.name} → ${s.name}`,{correct:s.guilty});
    setVerdict({correct:s.guilty,suspect:s,killer:caseData.suspects.find(x=>x.guilty),reason:caseData.killerReason,foundClues,revSuspicion:revState.suspicion,players,teamVotes});
    setShowAccuse(false);
  };

  const handleTimerExpire=()=>{
    logger.warn("GAME","Timer expired — killer escapes");
    setTimerExpired(true);
    setVerdict({correct:false,timerExpired:true,suspect:null,killer:caseData.suspects.find(x=>x.guilty),reason:caseData.killerReason,foundClues,revSuspicion:revState.suspicion,players,teamVotes});
  };

  // TUTORIAL
  const advanceTutorial=(step)=>{
    setTutorialStep(step);
    const steps=caseData.tutorialSteps||[];
    if(step>=steps.length)setTutorialStep(-1);
  };
  const currentTutorialStep=(caseData.tutorialSteps||[])[tutorialStep]||null;

  if(verdict)return<VerdictScreen verdict={verdict} caseData={caseData} player={player} onEnd={onEnd} isTutorial={isTutorial}/>;

  return(
    <div style={{minHeight:"100vh"}}>
      <div className="nav">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span className="logo-text">CASE<span className="logo-accent">ZERO</span></span>
          <span className="tag tag-amber" style={{fontSize:10}}>{caseData.title}</span>
          {isTutorial&&<span className="tag tag-green" style={{fontSize:9}}>🎓 TUTORIAL</span>}
          <span style={{fontSize:10,color:T.textMut,fontFamily:"'Space Mono',monospace"}}>{settings.openaiModel||"gpt-4o"}</span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
          {timerMinutes>0&&<CaseTimer timerMinutes={timerMinutes} onExpire={handleTimerExpire} paused={!!verdict}/>}
          {players.length>1&&players.map((p,i)=>(
            <div key={p.id} className="player-chip" style={{cursor:"pointer",opacity:i===curPlayer?1:0.4,borderColor:i===curPlayer?p.color:T.border}} onClick={()=>setCurPlayer(i)}>
              <div style={{width:7,height:7,borderRadius:"50%",background:p.color}}/><span style={{fontSize:11}}>{p.name}</span>
            </div>
          ))}
          {gameMode==="combined"&&<div style={{display:"flex",gap:3}}>
            {[["detective","🔍"],["interrogation","💬"]].map(([id,icon])=>(
              <button key={id} className={`btn ${phase===id?"btn-cyan":"btn-ghost"}`} style={{padding:"4px 10px",fontSize:11}} onClick={()=>{setPhase(id);if(isTutorial&&id==="interrogation"&&tutorialStep===1)advanceTutorial(2);}}>
                {icon}
              </button>
            ))}
          </div>}
          <button className="btn btn-teal" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setShowMobile(true)}>📱</button>
          <button className="btn btn-purple" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setShowReverse(true)}>🎯</button>
          {players.length>1&&<button className="btn btn-cyan" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setShowVote(true)}>🗳</button>}
          <button className="btn btn-red" style={{padding:"4px 10px",fontSize:11}} onClick={()=>{setShowAccuse(true);if(isTutorial&&tutorialStep===5)advanceTutorial(6);}}>⚖</button>
        </div>
      </div>

      <NarratorBar text={narrator.text} loading={narrator.loading}/>

      <div style={{maxWidth:1140,margin:"0 auto",padding:"14px 12px",display:"grid",gridTemplateColumns:"220px 1fr",gap:14}}>
        {/* SIDEBAR */}
        <div>
          {!settings.openaiKey&&<div style={{marginBottom:12}}><APIKeyWarning/></div>}
          {currentTutorialStep&&<TutorialTip step={currentTutorialStep} onDismiss={()=>setTutorialStep(-1)}/>}
          <div className="card" style={{marginBottom:11}}>
            <div className="section-label" style={{marginBottom:7}}>Case Brief</div>
            <div style={{fontSize:12,color:T.textSec,lineHeight:1.6,marginBottom:7}}>{caseData.summary}</div>
            <div style={{fontSize:11,color:T.textMut}}>Victim: <span style={{color:T.amber}}>{caseData.victim}</span></div>
          </div>
          <div className="card" style={{marginBottom:11}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><div className="section-label">Evidence</div><span style={{fontSize:11,color:T.cyan,fontFamily:"'Space Mono',monospace"}}>{foundClues.length}/{clues.length}</span></div>
            <div className="progress-track" style={{marginBottom:9}}><div className="progress-fill" style={{width:`${progress}%`}}/></div>
            {foundClues.map(c=>(
              <div key={c.id} style={{display:"flex",gap:8,paddingBottom:7}}>
                <div style={{display:"flex",flexDirection:"column",alignItems:"center"}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:c.critical?T.amber:T.cyan,flexShrink:0,marginTop:4}}/>
                  <div style={{width:1,flex:1,background:T.border,marginTop:2}}/>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11,fontWeight:600,marginBottom:1}}>{c.name}</div>
                  <div style={{fontSize:10,color:T.textSec,lineHeight:1.4}}>{c.description}</div>
                  {/* FORENSICS INLINE */}
                  {!forensicsState[c.id]?.report&&(
                    <button className="btn btn-ghost" style={{fontSize:9,padding:"2px 7px",marginTop:4}} onClick={()=>runForensics(c)} disabled={forensicsState[c.id]?.loading||!settings.openaiKey}>
                      {forensicsState[c.id]?.loading?<><span className="spinner" style={{width:10,height:10}}/>Scanning...</>:`🔬 ${forensicsUsed?"Analyze (uses hint)":"Analyze (free)"}`}
                    </button>
                  )}
                  {forensicsState[c.id]?.error&&<div style={{fontSize:10,color:T.red,marginTop:4}}>❌ {forensicsState[c.id].error}</div>}
                  {forensicsState[c.id]?.report&&(
                    <div style={{marginTop:6,padding:"7px 9px",background:T.bg2,borderRadius:6,border:`1px solid ${T.teal}33`}}>
                      <div style={{fontSize:9,color:T.teal,fontWeight:700,letterSpacing:"0.1em",marginBottom:4}}>🔬 FORENSICS REPORT</div>
                      <div style={{fontSize:10,color:T.textSec,lineHeight:1.5}}>{forensicsState[c.id].report}</div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {foundClues.length===0&&<p style={{fontSize:11,color:T.textMut}}>No evidence yet.</p>}
          </div>
          <div className="card card-purple" style={{marginBottom:11}}>
            <div className="section-label" style={{marginBottom:6}}>Your Suspicion</div>
            <SuspicionMeter value={revState.suspicion}/>
          </div>
          {settings.aiHints&&(
            <div className="card">
              <div className="section-label" style={{marginBottom:7}}>AI Game Master</div>
              {showHint?<p style={{fontSize:12,color:T.purple,lineHeight:1.6,fontStyle:"italic"}}>"{hint}"</p>
                :<button className="btn btn-ghost" style={{width:"100%",justifyContent:"center",fontSize:11}} onClick={getHint} disabled={(!diff.unlimitedHints&&hintUsed)||aiLoading||!settings.openaiKey}>
                  {aiLoading?<><span className="spinner"/>Thinking...</>:(!diff.unlimitedHints&&hintUsed)?"Hint used":"💡 Hint"}
                </button>}
              {diff.unlimitedHints&&<div style={{fontSize:10,color:T.green,marginTop:5}}>∞ unlimited (easy mode)</div>}
            </div>
          )}
        </div>

        {/* MAIN PANEL */}
        <div>
          {phase==="detective"&&<DetectivePanel caseData={caseData} clues={clues} activeRoom={activeRoom} setActiveRoom={setActiveRoom} discoverClue={discoverClue} notes={notes} setNotes={setNotes}/>}
          {phase==="interrogation"&&(
            <div className="anim-fade">
              <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap"}}>
                {[["interrogate","💬","Interrogate","btn-amber"],["cross","⚔","Cross-Exam","btn-orange"],["witnesses","👁","Witnesses","btn-teal"]].map(([id,icon,lbl,btn])=>(
                  <button key={id} className={`btn ${subTab===id?btn:"btn-ghost"}`} style={{padding:"6px 12px",fontSize:12}} onClick={()=>setSubTab(id)}>{icon} {lbl}</button>
                ))}
                <button className="btn btn-ghost" style={{padding:"6px 12px",fontSize:12,marginLeft:"auto"}} onClick={()=>setShowDossier(selSuspect||caseData.suspects[0])}>📋</button>
                <button className="btn btn-ghost" style={{padding:"6px 12px",fontSize:12}} onClick={()=>setShowTimeline(selSuspect||caseData.suspects[0])}>⏱</button>
              </div>
              {subTab==="interrogate"&&<InterrogPanel caseData={caseData} suspects={caseData.suspects} selSuspect={selSuspect} setSelSuspect={setSelSuspect} interrogHist={interrogHist} questionCounts={questionCounts} dynamicAlibis={dynamicAlibis} lieScores={lieScores} askSuspect={askSuspect} customQ={customQ} setCustomQ={setCustomQ} aiLoading={aiLoading} chatRef={chatRef} player={player} showLie={settings.lieDetector||diff.lieDetectorForce} hasKey={!!settings.openaiKey}/>}
              {subTab==="cross"&&<CrossExamPanel caseData={caseData} suspects={caseData.suspects} selSuspect={selSuspect} setSelSuspect={setSelSuspect} crossState={crossState} dynamicAlibis={dynamicAlibis} doCrossExam={doCrossExam} aiLoading={aiLoading} chatRef={chatRef} hasKey={!!settings.openaiKey}/>}
              {subTab==="witnesses"&&<WitnessPanel witnesses={caseData.witnesses||[]} witnessState={witnessState} callWitness={callWitness} askWitnessCustom={askWitnessCustom} aiLoading={aiLoading} chatRef={chatRef} player={player} hasKey={!!settings.openaiKey}/>}
            </div>
          )}
        </div>
      </div>

      {showAccuse&&<AccuseModal suspects={caseData.suspects} accusation={accusation} setAccusation={setAccusation} crossState={crossState} onConfirm={submitAccusation} onClose={()=>setShowAccuse(false)} player={player}/>}
      {showVote&&<TeamVoteModal players={players} suspects={caseData.suspects} teamVotes={teamVotes} setTeamVotes={setTeamVotes} onClose={()=>setShowVote(false)}/>}
      {showReverse&&<ReverseModal caseData={caseData} player={player} state={revState} setState={setRevState} onSubmit={submitRevAnswer} onClose={()=>setShowReverse(false)} diff={diff}/>}
      {showDossier&&<DossierModal suspect={showDossier} suspects={caseData.suspects} dynamicAlibis={dynamicAlibis} setShowDossier={setShowDossier}/>}
      {showTimeline&&<TimelineModal suspect={showTimeline} suspects={caseData.suspects} setShowTimeline={setShowTimeline}/>}
      {showMobile&&<MobileCompanionModal foundClues={foundClues} suspects={caseData.suspects} caseData={caseData} player={player} onClose={()=>setShowMobile(false)}/>}
      {settings.showDevLog&&<LogPanel/>}
    </div>
  );
}

// ============================================================
// DETECTIVE PANEL
// ============================================================
function DetectivePanel({caseData,clues,activeRoom,setActiveRoom,discoverClue,notes,setNotes}){
  const clueRoom=c=>c.room||caseData.rooms[Math.floor((clues.indexOf(c)/clues.length)*caseData.rooms.length)];
  const filtered=clues.filter(c=>clueRoom(c)===activeRoom);
  return(
    <div className="anim-fade">
      <div className="section-label" style={{marginBottom:9}}>Locations</div>
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap"}}>
        {caseData.rooms.map(r=>{const ct=clues.filter(c=>clueRoom(c)===r);return(
          <button key={r} className={`btn ${activeRoom===r?"btn-cyan":"btn-ghost"}`} style={{padding:"6px 12px",fontSize:12}} onClick={()=>setActiveRoom(r)}>
            {r} <span style={{opacity:0.55,fontSize:10}}>{ct.filter(c=>c.found).length}/{ct.length}</span>
          </button>
        );})}
      </div>
      <div className="card card-hi" style={{marginBottom:14}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
          <div><div style={{fontFamily:"'Space Mono',monospace",fontSize:16,color:T.cyan}}>{activeRoom}</div><div style={{fontSize:12,color:T.textSec,marginTop:2}}>Search for evidence</div></div>
          <span className="tag tag-cyan">{filtered.filter(c=>c.found).length}/{filtered.length}</span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:9}}>
          {filtered.length===0&&<p style={{color:T.textMut,fontSize:12,gridColumn:"1/-1"}}>No evidence here.</p>}
          {filtered.map(c=>(
            <div key={c.id} className={`card ${c.found?"card-amber":""}`} style={{cursor:c.found?"default":"pointer",opacity:c.found?1:0.65,padding:11,transition:"all 0.2s"}} onClick={()=>!c.found&&discoverClue(c)}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span style={{fontSize:18}}>{c.found?"🔎":"❓"}</span>{c.critical&&c.found&&<span className="tag tag-red" style={{fontSize:9}}>CRITICAL</span>}</div>
              <div style={{fontWeight:600,fontSize:12,marginBottom:c.found?4:0}}>{c.found?c.name:"Unknown Evidence"}</div>
              {c.found&&<div style={{fontSize:11,color:T.textSec,lineHeight:1.5}}>{c.description}</div>}
              {!c.found&&<div style={{fontSize:10,color:T.textMut,marginTop:3}}>Click to examine</div>}
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="section-label" style={{marginBottom:7}}>Notes — {activeRoom}</div>
        <textarea className="input" placeholder={`Observations about ${activeRoom}…`} value={notes[activeRoom]||""} onChange={e=>setNotes(n=>({...n,[activeRoom]:e.target.value}))} style={{minHeight:80}}/>
      </div>
    </div>
  );
}

// ============================================================
// INTERROGATION PANEL — with Mood badge + dynamic alibi display
// ============================================================
function InterrogPanel({caseData,suspects,selSuspect,setSelSuspect,interrogHist,questionCounts,dynamicAlibis,lieScores,askSuspect,customQ,setCustomQ,aiLoading,chatRef,player,showLie,hasKey}){
  const hist=selSuspect?(interrogHist[selSuspect.id]||[]):[];
  const lieScore=selSuspect?lieScores[selSuspect.id]:null;
  const qCount=selSuspect?(questionCounts[selSuspect.id]||0):0;
  const currentAlibi=selSuspect?(dynamicAlibis[selSuspect.id]||selSuspect.alibi):"";
  const alibiChanged=selSuspect&&dynamicAlibis[selSuspect.id]&&dynamicAlibis[selSuspect.id]!==selSuspect.alibi;
  return(
    <div style={{display:"grid",gridTemplateColumns:"185px 1fr",gap:12}}>
      <div>
        <div className="section-label" style={{marginBottom:9}}>Suspects</div>
        {suspects.map(s=>(
          <div key={s.id} className="card" style={{cursor:"pointer",marginBottom:7,padding:11,borderColor:selSuspect?.id===s.id?T.amber:T.border,background:selSuspect?.id===s.id?`${T.amber}10`:T.bg1}} onClick={()=>setSelSuspect(s)}>
            <div style={{fontWeight:600,fontSize:12,marginBottom:2}}>{s.name}</div>
            <div style={{fontSize:11,color:T.textSec}}>{s.role}</div>
            {(questionCounts[s.id]||0)>0&&<div style={{marginTop:5}}>
              <MoodBadge suspectId={s.id} questionCount={questionCounts[s.id]||0} guilty={s.guilty}/>
            </div>}
          </div>
        ))}
      </div>
      <div>
        {!selSuspect?<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:260,color:T.textMut,fontSize:13}}>Select a suspect →</div>:(
          <>
            <div className="card card-amber" style={{marginBottom:10,padding:12}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:14,color:T.amber}}>{selSuspect.name}</div>
                  <div style={{fontSize:12,color:T.textSec,marginTop:1}}>{selSuspect.role} · Age {selSuspect.age}</div>
                  <div style={{fontSize:11,color:alibiChanged?T.orange:T.textMut,marginTop:3,display:"flex",alignItems:"center",gap:6}}>
                    {alibiChanged&&<span style={{color:T.orange}}>⚡ UPDATED:</span>}Alibi: {currentAlibi}
                  </div>
                </div>
                {qCount>0&&<MoodBadge suspectId={selSuspect.id} questionCount={qCount} guilty={selSuspect.guilty}/>}
              </div>
              {showLie&&lieScore!=null&&<div style={{marginTop:10}}><LieMeter value={lieScore}/></div>}
            </div>
            <div ref={chatRef} style={{height:215,overflowY:"auto",display:"flex",flexDirection:"column",gap:8,marginBottom:10}}>
              {hist.length===0&&<div style={{textAlign:"center",color:T.textMut,fontSize:12,paddingTop:32}}>No questions yet.</div>}
              {hist.map((e,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{display:"flex",justifyContent:"flex-end"}}><div className="chat-bubble chat-user"><span style={{fontSize:10,color:T.cyan,display:"block",marginBottom:2}}>{e.player}</span>{e.q}</div></div>
                  <div style={{display:"flex",flexDirection:"column",gap:3}}>
                    <div style={{display:"flex",justifyContent:"flex-start"}}><div className={`chat-bubble ${e.isError?"chat-error":"chat-ai"}`}>
                      {!e.isError&&<span style={{fontSize:10,color:T.amber,display:"block",marginBottom:2}}>{selSuspect.name} {e.mood&&<span style={{color:MOODS[e.mood]?.color}}>· {MOODS[e.mood]?.icon} {e.mood}</span>}</span>}
                      {e.a}
                    </div></div>
                    {showLie&&e.lieScore!=null&&<span style={{fontSize:10,color:e.lieScore>60?T.orange:T.textMut,paddingLeft:4}}>🧠 {e.lieScore}% — {e.lieScore<25?"truthful":e.lieScore<50?"uncertain":e.lieScore<75?"evasive":"likely lying"}</span>}
                  </div>
                </div>
              ))}
              {aiLoading&&<div style={{display:"flex",gap:7,alignItems:"center",padding:"5px 8px"}}><span className="spinner"/><span style={{fontSize:11,color:T.textMut}}>{selSuspect.name} responding…</span></div>}
            </div>
            {!hasKey&&<div style={{marginBottom:10}}><APIKeyWarning/></div>}
            {caseData.interrogationQuestions?.[selSuspect.id]?.length>0&&<div style={{marginBottom:9}}>
              <div className="section-label" style={{marginBottom:5}}>Suggested</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>{caseData.interrogationQuestions[selSuspect.id].map((item,i)=>(<button key={i} className="btn btn-ghost" style={{fontSize:10,padding:"4px 9px"}} onClick={()=>askSuspect(selSuspect,item.q)} disabled={aiLoading||!hasKey}>{item.q.slice(0,34)}…</button>))}</div>
            </div>}
            <div style={{display:"flex",gap:7}}>
              <input className="input" placeholder={hasKey?`Ask ${selSuspect.name.split(" ")[0]} anything…`:"Add OpenAI key in Settings to interrogate"} value={customQ} onChange={e=>setCustomQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&customQ.trim()&&!aiLoading&&hasKey&&askSuspect(selSuspect,customQ)} style={{flex:1}} disabled={!hasKey}/>
              <button className="btn btn-amber" disabled={!customQ.trim()||aiLoading||!hasKey} onClick={()=>askSuspect(selSuspect,customQ)}>{aiLoading?<span className="spinner"/>:"Ask"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// CROSS-EXAM PANEL — shows dynamic alibi changes
// ============================================================
function CrossExamPanel({caseData,suspects,selSuspect,setSelSuspect,crossState,dynamicAlibis,doCrossExam,aiLoading,chatRef,hasKey}){
  const [tactic,setTactic]=useState(null);
  const TACTICS=[{id:"evidence",icon:"🔎",l:"Present Evidence"},{id:"contradiction",icon:"⚔",l:"Point Contradiction"},{id:"bluff",icon:"🎭",l:"Bluff Pressure"},{id:"witness",icon:"👁",l:"Cite Witness"}];
  const state=selSuspect?(crossState[selSuspect.id]||{round:0,cracked:false,history:[]}):null;
  const examData=selSuspect?caseData.crossExam?.[selSuspect.id]:null;
  const pct=state&&examData?Math.min(100,Math.round((state.round/(examData.crack_threshold||3))*100)):0;
  const alibiChanged=selSuspect&&dynamicAlibis[selSuspect.id]&&dynamicAlibis[selSuspect.id]!==selSuspect.alibi;
  return(
    <div style={{display:"grid",gridTemplateColumns:"185px 1fr",gap:12}}>
      <div>
        <div className="section-label" style={{marginBottom:9}}>Suspects</div>
        {suspects.map(s=>{const cs=crossState[s.id]||{};return(
          <div key={s.id} className="card" style={{cursor:"pointer",marginBottom:7,padding:11,borderColor:selSuspect?.id===s.id?T.orange:T.border,background:selSuspect?.id===s.id?`${T.orange}10`:T.bg1}} onClick={()=>setSelSuspect(s)}>
            <div style={{fontWeight:600,fontSize:12,marginBottom:2}}>{s.name}</div>
            <div style={{fontSize:11,color:T.textSec}}>{s.role}</div>
            <div style={{display:"flex",gap:4,marginTop:4,flexWrap:"wrap"}}>
              {cs.cracked&&<span className="tag tag-red" style={{fontSize:9}}>CRACKED</span>}
              {cs.round>0&&!cs.cracked&&<span className="tag tag-orange" style={{fontSize:9}}>Rd {cs.round}</span>}
              {dynamicAlibis[s.id]&&<span className="tag tag-amber" style={{fontSize:9}}>⚡ ALIBI SHIFTED</span>}
            </div>
          </div>
        );})}
      </div>
      <div>
        {!selSuspect?<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:260,color:T.textMut,fontSize:13}}>Select suspect →</div>:(
          <>
            <div className="card card-orange" style={{marginBottom:10,padding:12}}>
              <div style={{fontFamily:"'Space Mono',monospace",fontSize:14,color:T.orange,marginBottom:2}}>{selSuspect.name} — Rd {state.round}</div>
              {alibiChanged&&<div style={{padding:"7px 10px",background:`${T.amber}10`,border:`1px solid ${T.amber}33`,borderRadius:6,fontSize:11,marginBottom:8}}>
                <span style={{color:T.amber,fontWeight:700}}>⚡ ALIBI SHIFTED: </span><span style={{color:T.textSec}}>{dynamicAlibis[selSuspect.id]}</span>
              </div>}
              {examData&&<>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                  <div style={{flex:1}} className="susp-track"><div className="susp-fill" style={{width:`${pct}%`,background:`linear-gradient(90deg,${T.amber}88,${T.red})`}}/></div>
                  <span style={{fontSize:11,fontFamily:"'Space Mono',monospace",color:T.orange}}>{pct}%</span>
                </div>
                <div style={{fontSize:11,color:T.textMut}}>Contradiction: <span style={{color:T.textSec}}>{examData.contradiction}</span></div>
              </>}
            </div>
            <div ref={chatRef} style={{height:175,overflowY:"auto",display:"flex",flexDirection:"column",gap:7,marginBottom:10}}>
              {state.history.length===0&&<div style={{textAlign:"center",color:T.textMut,fontSize:12,paddingTop:28}}>Choose a tactic to start pressing {selSuspect.name}.</div>}
              {state.history.map((e,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",gap:5}}>
                  <div style={{display:"flex",justifyContent:"flex-end"}}><div className="chat-bubble chat-user" style={{background:`${T.orange}15`,borderColor:`${T.orange}33`}}><span style={{fontSize:10,color:T.orange,display:"block",marginBottom:2}}>Tactic: {e.tactic}</span>Pressing the contradiction…</div></div>
                  <div style={{display:"flex",justifyContent:"flex-start"}}><div className={`chat-bubble ${e.isError?"chat-error":e.cracked?"chat-pressure":"chat-ai"}`}>
                    {!e.isError&&<span style={{fontSize:10,color:e.cracked?T.red:T.textMut,display:"block",marginBottom:2}}>{e.cracked?"⚠ CRACKING — ":""}{selSuspect.name} Rd {e.round}</span>}
                    {e.response}
                  </div></div>
                </div>
              ))}
              {aiLoading&&<div style={{display:"flex",gap:7,alignItems:"center"}}><span className="spinner"/><span style={{fontSize:11,color:T.textMut}}>Applying pressure…</span></div>}
            </div>
            {!state.cracked?(
              <>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:9}}>
                  {TACTICS.map(t=>(
                    <div key={t.id} className={`cross-tactic ${tactic===t.id?"selected":""}`} onClick={()=>setTactic(t.id)} style={{display:"flex",alignItems:"center",gap:8}}>
                      <span>{t.icon}</span><div style={{fontSize:12,fontWeight:600,color:tactic===t.id?T.orange:T.textPri}}>{t.l}</div>
                    </div>
                  ))}
                </div>
                {!hasKey&&<div style={{marginBottom:9}}><APIKeyWarning/></div>}
                <button className="btn btn-orange" style={{width:"100%",justifyContent:"center"}} disabled={!tactic||aiLoading||!hasKey} onClick={()=>{doCrossExam(selSuspect,tactic);setTactic(null);}}>
                  {aiLoading?<><span className="spinner"/>Pressing…</>:"⚔ Press the Contradiction"}
                </button>
              </>
            ):(
              <div className="card card-red pulse-red" style={{padding:14,textAlign:"center"}}>
                <div style={{fontSize:28,marginBottom:6}}>💥</div>
                <div style={{fontFamily:"'Space Mono',monospace",color:T.red,marginBottom:4}}>Suspect Cracked</div>
                <p style={{fontSize:13,color:T.textSec}}>Check their last response for the truth.</p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// WITNESS PANEL
// ============================================================
function WitnessPanel({witnesses,witnessState,callWitness,askWitnessCustom,aiLoading,chatRef,player,hasKey}){
  const [selWitness,setSelWitness]=useState(null);
  const [customQ,setCustomQ]=useState("");
  const TRIGGERS=[{id:"general",label:"Initial Statement",icon:"💬"},{id:"diana",label:"About Diana",icon:"👤"},{id:"noah",label:"About Noah",icon:"👤"},{id:"marcus",label:"About Marcus",icon:"👤"},{id:"coach",label:"About Coach",icon:"👤"},{id:"suspicious",label:"Suspicious Behavior",icon:"🔍"},{id:"camera",label:"About Evidence",icon:"📷"},{id:"victim",label:"About Victim",icon:"🎯"}];
  const wState=selWitness?witnessState[selWitness.id]:null;
  const hist=wState?.chatHistory||[];
  if(!witnesses||witnesses.length===0)return<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:280,color:T.textMut,fontSize:13,gap:8}}><span style={{fontSize:32}}>👤</span><div>No witnesses in this case.</div></div>;
  return(
    <div style={{display:"grid",gridTemplateColumns:"185px 1fr",gap:12}}>
      <div>
        <div className="section-label" style={{marginBottom:9}}>Witnesses</div>
        {witnesses.map(w=>(
          <div key={w.id} className={`witness-card ${selWitness?.id===w.id?"selected":""}`} style={{marginBottom:7}} onClick={()=>setSelWitness(w)}>
            <div style={{display:"flex",alignItems:"center",gap:9,marginBottom:4}}>
              <span style={{fontSize:22}}>{w.avatar||"👤"}</span>
              <div><div style={{fontWeight:600,fontSize:12}}>{w.name}</div><div style={{fontSize:11,color:T.textSec}}>{w.role}</div></div>
            </div>
            <div style={{fontSize:11,color:T.textMut,lineHeight:1.4}}>{w.summary}</div>
            {witnessState[w.id]?.unlocked&&<span className="tag tag-teal" style={{fontSize:9,marginTop:5}}>SPOKE TO DETECTIVE</span>}
          </div>
        ))}
      </div>
      <div>
        {!selWitness?<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:280,color:T.textMut,fontSize:13}}>Select a witness →</div>:(
          <>
            <div className="card card-teal" style={{marginBottom:10,padding:12}}>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:26}}>{selWitness.avatar||"👤"}</span>
                <div>
                  <div style={{fontFamily:"'Space Mono',monospace",fontSize:14,color:T.teal}}>{selWitness.name}</div>
                  <div style={{fontSize:12,color:T.textSec,marginTop:1}}>{selWitness.role}</div>
                  <div style={{fontSize:11,color:T.textMut,marginTop:2}}>{selWitness.summary}</div>
                </div>
              </div>
            </div>
            <div style={{marginBottom:9}}>
              <div className="section-label" style={{marginBottom:6}}>Ask about…</div>
              <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                {TRIGGERS.filter(t=>selWitness.statements?.some(s=>s.trigger===t.id)).map(t=>(
                  <button key={t.id} className="btn btn-teal" style={{padding:"5px 10px",fontSize:10}} onClick={()=>callWitness(selWitness,t.id)} disabled={aiLoading}>{t.icon} {t.label}</button>
                ))}
              </div>
            </div>
            <div ref={chatRef} style={{height:185,overflowY:"auto",display:"flex",flexDirection:"column",gap:7,marginBottom:10}}>
              {hist.length===0&&<div style={{textAlign:"center",color:T.textMut,fontSize:12,paddingTop:28}}>Select a topic above or ask a custom question.</div>}
              {hist.map((e,i)=>(
                <div key={i} style={{display:"flex",flexDirection:"column",gap:5}}>
                  {e.question&&<div style={{display:"flex",justifyContent:"flex-end"}}><div className="chat-bubble chat-user"><span style={{fontSize:10,color:T.cyan,display:"block",marginBottom:2}}>{e.player||player.name}</span>{e.question}</div></div>}
                  {!e.question&&<div className="chat-bubble chat-system" style={{alignSelf:"center",fontSize:11}}>Asked about: {e.trigger}</div>}
                  <div style={{display:"flex",justifyContent:"flex-start"}}><div className={`chat-bubble ${e.response?.startsWith("[")?"chat-error":"chat-witness"}`}><span style={{fontSize:10,color:T.teal,display:"block",marginBottom:2}}>{selWitness.name}</span>{e.response}</div></div>
                </div>
              ))}
              {aiLoading&&<div style={{display:"flex",gap:7,alignItems:"center"}}><span className="spinner"/><span style={{fontSize:11,color:T.textMut}}>{selWitness.name} thinking…</span></div>}
            </div>
            {!hasKey&&<div style={{marginBottom:9}}><APIKeyWarning/></div>}
            <div style={{display:"flex",gap:7}}>
              <input className="input" placeholder={`Ask ${selWitness.name.split(" ")[0]} anything…`} value={customQ} onChange={e=>setCustomQ(e.target.value)} onKeyDown={e=>e.key==="Enter"&&customQ.trim()&&!aiLoading&&(askWitnessCustom(selWitness,customQ),setCustomQ(""))} style={{flex:1}}/>
              <button className="btn btn-teal" disabled={!customQ.trim()||aiLoading} onClick={()=>{askWitnessCustom(selWitness,customQ);setCustomQ("");}}>Ask</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================
function AccuseModal({suspects,accusation,setAccusation,crossState,onConfirm,onClose,player}){
  return(
    <div className="modal-overlay">
      <div className="modal">
        <h3 style={{fontFamily:"'Space Mono',monospace",color:T.red,marginBottom:8}}>⚖ Final Accusation</h3>
        <p style={{color:T.textSec,fontSize:13,marginBottom:16}}>One chance. Choose carefully, {player.name}.</p>
        <div style={{display:"flex",flexDirection:"column",gap:9,marginBottom:16}}>
          {suspects.map(s=>(
            <div key={s.id} className={`accusation-card ${accusation===s.id?"selected":""}`} onClick={()=>setAccusation(s.id)}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:600,marginBottom:2}}>{s.name}</div>
                  <div style={{fontSize:12,color:T.textSec}}>{s.role}</div>
                  {crossState[s.id]?.cracked&&<span className="tag tag-red" style={{fontSize:9,marginTop:5}}>CRACKED UNDER PRESSURE</span>}
                </div>
                {accusation===s.id&&<span style={{color:T.red,fontSize:20}}>◉</span>}
              </div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:9}}><button className="btn btn-red" disabled={!accusation} onClick={onConfirm} style={{flex:1}}>Confirm Accusation</button><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  );
}

function TeamVoteModal({players,suspects,teamVotes,setTeamVotes,onClose}){
  const tally={};suspects.forEach(s=>{tally[s.id]=Object.values(teamVotes).filter(v=>v===s.id).length;});
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}><h3 style={{fontFamily:"'Space Mono',monospace",color:T.cyan}}>🗳 Team Vote</h3><button className="btn btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={onClose}>✕</button></div>
        {players.map(p=>(
          <div key={p.id} style={{marginBottom:14}}>
            <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:7}}><div style={{width:8,height:8,borderRadius:"50%",background:p.color}}/><span style={{fontSize:13,fontWeight:600}}>{p.name}</span></div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:7}}>
              {suspects.map(s=>(
                <div key={s.id} style={{padding:"9px 11px",borderRadius:8,cursor:"pointer",border:`2px solid ${teamVotes[p.id]===s.id?T.cyan:T.border}`,background:teamVotes[p.id]===s.id?`${T.cyan}12`:T.bg2,transition:"all 0.15s"}} onClick={()=>setTeamVotes(v=>({...v,[p.id]:s.id}))}>
                  <div style={{fontSize:12,fontWeight:600,color:teamVotes[p.id]===s.id?T.cyan:T.textPri}}>{s.name}</div>
                  <div style={{fontSize:10,color:T.textSec}}>{s.role}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div className="card card-hi" style={{padding:12,marginTop:8}}>
          <div className="section-label" style={{marginBottom:8}}>Tally</div>
          {suspects.map(s=>(
            <div key={s.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:7}}>
              <div style={{width:100,fontSize:12,color:T.textSec}}>{s.name}</div>
              <div style={{flex:1}} className="progress-track"><div className="progress-fill" style={{width:`${players.length?(tally[s.id]/players.length)*100:0}%`,background:T.cyan}}/></div>
              <span style={{fontSize:12,color:T.cyan,fontFamily:"'Space Mono',monospace",width:16}}>{tally[s.id]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ReverseModal({caseData,player,state,setState,onSubmit,onClose,diff}){
  const ri=caseData.reverseInterrogation;
  const qList=ri?.ai_questions?.slice(0,diff.reverseQuestions)||[];
  const curQ=qList[state.qIdx];
  const ref=useRef(null);
  useEffect(()=>{if(ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[state.history]);
  const suspColor=state.suspicion<30?T.green:state.suspicion<60?T.amber:state.suspicion<80?T.orange:T.red;
  return(
    <div className="modal-overlay">
      <div className="modal modal-wide">
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:14}}>
          <div><span className="tag tag-purple" style={{marginBottom:7,display:"inline-flex"}}>🎯 Reverse Interrogation</span><h3 style={{fontFamily:"'Space Mono',monospace",color:T.purple,marginTop:4}}>You're in the hot seat, {player.name}</h3><p style={{fontSize:12,color:T.textSec,marginTop:3}}>{qList.length} questions — {diff.label}</p></div>
          {state.done&&<button className="btn btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={onClose}>✕</button>}
        </div>
        <div className="card card-purple" style={{padding:11,marginBottom:12}}><SuspicionMeter value={state.suspicion} label={`${player.name}'s Suspicion`}/></div>
        {/* ERROR DISPLAY */}
        {state.error&&<div className="api-warning" style={{marginBottom:12}}><span style={{fontSize:18}}>❌</span><div><div style={{fontWeight:600,fontSize:13,color:T.red,marginBottom:2}}>AI Error</div><div style={{fontSize:12,color:T.textSec}}>{state.error}</div></div></div>}
        <div ref={ref} style={{height:190,overflowY:"auto",display:"flex",flexDirection:"column",gap:9,marginBottom:12}}>
          {state.history.length===0&&!state.loading&&<div className="chat-bubble chat-system" style={{alignSelf:"center"}}>The interrogator enters. Pressure fills the room.</div>}
          {state.history.map((e,i)=>(
            <div key={i} style={{display:"flex",flexDirection:"column",gap:6}}>
              <div style={{display:"flex",justifyContent:"flex-start"}}><div className="chat-bubble chat-reverse"><span style={{fontSize:10,color:T.purple,display:"block",marginBottom:2}}>Interrogator</span>{e.q}</div></div>
              <div style={{display:"flex",justifyContent:"flex-end"}}><div className="chat-bubble chat-user"><span style={{fontSize:10,color:T.cyan,display:"block",marginBottom:2}}>{player.name}</span>{e.a}</div></div>
              <div style={{display:"flex",justifyContent:"flex-start"}}><div className={`chat-bubble ${e.delta>5?"chat-pressure":"chat-ai"}`} style={{background:e.delta>5?`${T.red}10`:`${T.purple}10`,borderColor:e.delta>5?`${T.red}33`:`${T.purple}33`}}>
                <span style={{fontSize:10,color:e.delta>5?T.red:T.purple,display:"block",marginBottom:2}}>Credibility: {e.score}/10 · {e.delta>0?`▲ +${e.delta}% suspicion`:`▼ ${Math.abs(e.delta)}% suspicion`}</span>
                {e.aiResp}
              </div></div>
            </div>
          ))}
          {state.loading&&<div style={{display:"flex",gap:7,alignItems:"center",padding:"5px 8px"}}><span className="spinner"/><span style={{fontSize:11,color:T.textMut}}>Interrogator considering…</span></div>}
        </div>
        {!state.done&&curQ&&!state.loading?(
          <>
            <div className="card card-purple" style={{padding:12,marginBottom:10}}>
              <div className="section-label" style={{marginBottom:5}}>Interrogator asks:</div>
              <p style={{fontSize:14,lineHeight:1.6}}>{curQ}</p>
            </div>
            <div style={{display:"flex",gap:7}}>
              <input className="input" placeholder="Your answer (be convincing)…" value={state.ans} onChange={e=>setState(s=>({...s,ans:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&state.ans.trim()&&onSubmit()} style={{flex:1}}/>
              <button className="btn btn-purple" disabled={!state.ans.trim()||state.loading} onClick={onSubmit}>Answer</button>
            </div>
          </>
        ):state.done?(
          <div style={{textAlign:"center"}}>
            <div className="card" style={{padding:18,background:`${suspColor}10`,borderColor:`${suspColor}44`,marginBottom:12}}>
              <div style={{fontSize:36,marginBottom:7}}>{state.suspicion<30?"✅":state.suspicion<60?"😬":"🚨"}</div>
              <div style={{fontFamily:"'Space Mono',monospace",color:suspColor,fontSize:16,marginBottom:5}}>Final Suspicion: {state.suspicion}%</div>
              <p style={{fontSize:13,color:T.textSec}}>{state.suspicion<30?"You handled yourself well. Clear.":state.suspicion<60?"Shaky performance. They're watching.":state.suspicion<80?"Serious scrutiny. You're a suspect.":"They nearly arrested you. Solve this fast."}</p>
            </div>
            <button className="btn btn-cyan" onClick={onClose} style={{width:"100%"}}>← Return to Investigation</button>
          </div>
        ):null}
      </div>
    </div>
  );
}

function DossierModal({suspect,suspects,dynamicAlibis,setShowDossier}){
  const [cur,setCur]=useState(suspect);const d=cur.dossier||{};
  const alibiChanged=dynamicAlibis[cur.id]&&dynamicAlibis[cur.id]!==cur.alibi;
  return(
    <div className="modal-overlay" onClick={()=>setShowDossier(null)}>
      <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}><div><h3 style={{fontFamily:"'Space Mono',monospace",color:T.purple}}>{cur.name} — Dossier</h3><div style={{fontSize:13,color:T.textSec,marginTop:4}}>{cur.role} · Age {cur.age}</div></div><button className="btn btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={()=>setShowDossier(null)}>✕</button></div>
        <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>{suspects.map(s=><button key={s.id} className={`btn ${cur.id===s.id?"btn-purple":"btn-ghost"}`} style={{padding:"4px 10px",fontSize:11}} onClick={()=>setCur(s)}>{s.name.split(" ")[0]}</button>)}</div>
        {alibiChanged&&<div style={{padding:"8px 12px",background:`${T.orange}10`,border:`1px solid ${T.orange}33`,borderRadius:8,marginBottom:14,fontSize:12}}>
          <span style={{color:T.orange,fontWeight:700}}>⚡ ALIBI UPDATED DURING CROSS-EXAM: </span><span style={{color:T.textSec}}>{dynamicAlibis[cur.id]}</span>
        </div>}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {[["Background",d.background],["Known Associates",d.knownAssociates],["Prior Record",d.priorRecord],["Financials",d.financials]].map(([l,v])=>(
            <div key={l} className="card" style={{padding:13}}><div className="section-label" style={{marginBottom:5}}>{l}</div><div style={{fontSize:13,color:T.textSec,lineHeight:1.6}}>{v||"Unknown"}</div></div>
          ))}
        </div>
        <div className="card" style={{padding:13}}><div className="section-label" style={{marginBottom:5}}>Original Alibi</div><div style={{fontSize:13,color:T.textSec}}>{cur.alibi}</div></div>
      </div>
    </div>
  );
}

function TimelineModal({suspect,suspects,setShowTimeline}){
  const [cur,setCur]=useState(suspect);const tl=cur.timeline||[];
  return(
    <div className="modal-overlay" onClick={()=>setShowTimeline(null)}>
      <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}><div><h3 style={{fontFamily:"'Space Mono',monospace",color:T.cyan}}>{cur.name} — Alibi Timeline</h3><div style={{fontSize:13,color:T.textSec,marginTop:4}}>{cur.role}</div></div><button className="btn btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={()=>setShowTimeline(null)}>✕</button></div>
        <div style={{display:"flex",gap:7,marginBottom:18,flexWrap:"wrap"}}>{suspects.map(s=><button key={s.id} className={`btn ${cur.id===s.id?"btn-cyan":"btn-ghost"}`} style={{padding:"4px 10px",fontSize:11}} onClick={()=>setCur(s)}>{s.name.split(" ")[0]}</button>)}</div>
        <div style={{position:"relative",paddingLeft:18}}>
          <div style={{position:"absolute",left:5,top:0,bottom:0,width:1,background:T.border}}/>
          {tl.length===0&&<p style={{color:T.textMut,fontSize:13}}>No timeline data.</p>}
          {tl.map((e,i)=>(
            <div key={i} style={{display:"flex",gap:12,marginBottom:14,position:"relative"}}>
              <div style={{position:"absolute",left:-14,top:4,width:8,height:8,borderRadius:"50%",background:T.cyan,border:`2px solid ${T.bg1}`}}/>
              <div><div style={{fontFamily:"'Space Mono',monospace",fontSize:12,color:T.cyan,marginBottom:2}}>{e.time}</div><div style={{fontSize:13,color:T.textSec,lineHeight:1.5}}>{e.action}</div></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MobileCompanionModal({foundClues,suspects,caseData,player,onClose}){
  const [tab,setTab]=useState("clues");
  const [copied,setCopied]=useState(false);
  const summary=`CASEZERO — ${caseData.title}\nDetective: ${player.name}\n\nCLUES (${foundClues.length}):\n${foundClues.map(c=>`• ${c.name}: ${c.description}`).join("\n")||"None"}\n\nSUSPECTS:\n${suspects.map(s=>`• ${s.name} (${s.role}) — ${s.alibi}`).join("\n")}`;
  const copy=()=>{navigator.clipboard.writeText(summary).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),2000);}).catch(()=>{});};
  return(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:18}}><div><span className="tag tag-teal" style={{marginBottom:8,display:"inline-flex"}}>📱 Mobile Companion</span><h3 style={{fontFamily:"'Space Mono',monospace",color:T.teal,marginTop:6}}>Your Case — Mobile View</h3></div><button className="btn btn-ghost" style={{padding:"5px 10px",fontSize:12}} onClick={onClose}>✕</button></div>
        <div style={{display:"flex",gap:7,marginBottom:16}}>
          {[["clues","🔎 Clues"],["suspects","👤 Suspects"],["share","📤 Share"]].map(([id,lbl])=>(
            <button key={id} className={`btn ${tab===id?"btn-teal":"btn-ghost"}`} style={{padding:"6px 12px",fontSize:12}} onClick={()=>setTab(id)}>{lbl}</button>
          ))}
        </div>
        {tab==="clues"&&(
          <div style={{background:T.bg0,border:`2px solid ${T.border}`,borderRadius:16,padding:16,maxWidth:300,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:12}}>
              <div style={{fontSize:10,color:T.cyan,fontFamily:"'Space Mono',monospace"}}>CASEZERO · FIELD NOTES</div>
              <div style={{fontSize:14,fontWeight:600,marginTop:4}}>{caseData.title}</div>
              <div style={{fontSize:11,color:T.textSec,marginTop:2}}>Det. {player.name}</div>
            </div>
            {foundClues.length===0&&<div style={{textAlign:"center",color:T.textMut,fontSize:13,padding:20}}>No clues yet.</div>}
            {foundClues.map(c=>(
              <div key={c.id} style={{background:T.bg1,border:`1px solid ${T.border}`,borderRadius:9,padding:11,marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}><span>{c.critical?"🔑":"🔎"}</span>{c.critical&&<span className="tag tag-amber" style={{fontSize:9}}>KEY</span>}</div>
                <div style={{fontSize:13,fontWeight:600,marginBottom:3}}>{c.name}</div>
                <div style={{fontSize:12,color:T.textSec,lineHeight:1.5}}>{c.description}</div>
              </div>
            ))}
          </div>
        )}
        {tab==="suspects"&&(
          <div style={{background:T.bg0,border:`2px solid ${T.border}`,borderRadius:16,padding:16,maxWidth:300,margin:"0 auto"}}>
            <div style={{textAlign:"center",marginBottom:12}}><div style={{fontSize:11,color:T.amber,fontFamily:"'Space Mono',monospace"}}>SUSPECT PROFILES</div></div>
            {suspects.map(s=>(
              <div key={s.id} style={{background:T.bg1,border:`1px solid ${T.border}`,borderRadius:9,padding:11,marginBottom:8}}>
                <div style={{fontWeight:600,fontSize:13,marginBottom:2}}>{s.name}</div>
                <div style={{fontSize:11,color:T.amber,marginBottom:3}}>{s.role}</div>
                <div style={{fontSize:11,color:T.textSec}}>Alibi: {s.alibi}</div>
              </div>
            ))}
          </div>
        )}
        {tab==="share"&&(
          <div>
            <div className="card card-teal" style={{marginBottom:14,padding:14}}>
              <div className="section-label" style={{marginBottom:8}}>Copy Case Summary</div>
              <div style={{fontSize:11,color:T.textSec,lineHeight:1.7,fontFamily:"'Space Mono',monospace",whiteSpace:"pre-wrap",background:T.bg0,padding:10,borderRadius:8,maxHeight:180,overflowY:"auto",marginBottom:12}}>{summary}</div>
              <button className={`btn ${copied?"btn-green":"btn-teal"}`} style={{width:"100%",justifyContent:"center"}} onClick={copy}>{copied?"✅ Copied!":"📋 Copy to Clipboard"}</button>
            </div>
            <div className="card" style={{padding:14}}>
              <div className="section-label" style={{marginBottom:8}}>Mobile Tips</div>
              {["Copy & paste into your phone's Notes app","Screenshot the Clues tab for quick reference","Pass the device during hot-seat multiplayer","Text the summary to other players as their briefing"].map((t,i)=>(
                <div key={i} style={{display:"flex",gap:10,marginBottom:8}}><span style={{color:T.teal,fontWeight:700,fontSize:13,flexShrink:0}}>{i+1}.</span><span style={{fontSize:13,color:T.textSec,lineHeight:1.5}}>{t}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// VERDICT
// ============================================================
function VerdictScreen({verdict,caseData,player,onEnd,isTutorial}){
  const [reveal,setReveal]=useState(false);
  const [tab,setTab]=useState("result");
  const isTimerExpiry=verdict.timerExpired;
  return(
    <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:24}}>
      <div className="card anim-up" style={{maxWidth:620,width:"100%",padding:30}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:48,marginBottom:10}}>{isTimerExpiry?"⌛":verdict.correct?"🏆":verdict.permadeath?"💀":"😞"}</div>
          <div className={`tag ${verdict.correct?"tag-green":isTimerExpiry?"tag-amber":"tag-red"}`} style={{marginBottom:10}}>
            {isTimerExpiry?"TIME EXPIRED — KILLER ESCAPED":verdict.correct?"CASE SOLVED":verdict.permadeath?"GAME OVER":"WRONG ACCUSATION"}
          </div>
          <h2 style={{fontFamily:"'Space Mono',monospace",fontSize:22,marginBottom:7}}>
            {isTimerExpiry?"The clock ran out. The killer walks free.":verdict.correct?"Brilliant work, Detective.":verdict.permadeath?"One shot. One miss.":"The real killer walks free."}
          </h2>
          <p style={{color:T.textSec,fontSize:13,lineHeight:1.7}}>
            {isTimerExpiry?`The case ran out of time. ${verdict.killer.name} escaped.`:verdict.correct?`${player.name} correctly identified ${verdict.killer.name}.`:`${player.name} accused ${verdict.suspect?.name||"nobody"}. The killer was ${verdict.killer.name}.`}
          </p>
          {isTutorial&&verdict.correct&&<div style={{marginTop:10,padding:"10px 14px",background:`${T.green}10`,border:`1px solid ${T.green}33`,borderRadius:8}}><div style={{fontSize:13,color:T.green}}>🎓 Tutorial Complete! You're ready for the real cases.</div></div>}
        </div>
        <div style={{display:"flex",gap:6,marginBottom:14}}>
          {[["result","Result"],["debrief","Debrief"],["evidence","Evidence"],["votes","Votes"]].map(([id,lbl])=>(
            <button key={id} className={`btn ${tab===id?"btn-cyan":"btn-ghost"}`} style={{padding:"5px 11px",fontSize:11,flex:1,justifyContent:"center"}} onClick={()=>setTab(id)}>{lbl}</button>
          ))}
        </div>
        {tab==="result"&&(!reveal?<button className="btn btn-amber" style={{width:"100%",justifyContent:"center",marginBottom:12}} onClick={()=>setReveal(true)}>Reveal Full Truth</button>:(
          <div className="card card-amber" style={{padding:14,marginBottom:12}}>
            <div className="section-label" style={{marginBottom:6}}>The Full Story</div>
            <div style={{fontWeight:600,color:T.amber,marginBottom:5}}>Killer: {verdict.killer.name} · {verdict.killer.role}</div>
            <p style={{fontSize:13,color:T.textSec,lineHeight:1.7}}>{verdict.reason}</p>
          </div>
        ))}
        {tab==="debrief"&&<div>
          <div className="card" style={{padding:13,marginBottom:10}}><div className="section-label" style={{marginBottom:6}}>Your Suspicion</div><SuspicionMeter value={verdict.revSuspicion||15}/><div style={{fontSize:11,color:T.textMut,marginTop:5}}>{(verdict.revSuspicion||15)<40?"Stayed clear during grilling.":"Your alibi raised some eyebrows."}</div></div>
          <div className="card" style={{padding:13}}><div className="section-label" style={{marginBottom:6}}>Evidence</div><div style={{fontSize:13,color:T.textSec,marginBottom:8}}>{verdict.foundClues.length} of {caseData.clues.length} clues found</div>{verdict.foundClues.map(c=><div key={c.id} style={{display:"flex",gap:7,marginBottom:6}}><span style={{color:c.critical?T.amber:T.cyan,fontSize:12}}>◆</span><span style={{fontSize:12,color:T.textSec}}><b>{c.name}</b> — {c.description}</span></div>)}</div>
        </div>}
        {tab==="evidence"&&<div>
          <div className="section-label" style={{marginBottom:10}}>All Clues Revealed</div>
          {caseData.clues.map(c=><div key={c.id} style={{display:"flex",gap:9,marginBottom:9,opacity:c.found?1:0.5}}>
            <span style={{fontSize:15,flexShrink:0}}>{c.found?"🔎":"❓"}</span>
            <div><div style={{fontSize:13,fontWeight:600,marginBottom:2}}>{c.name}{c.critical&&<span className="tag tag-red" style={{fontSize:9,marginLeft:6}}>CRITICAL</span>}</div><div style={{fontSize:12,color:T.textSec,lineHeight:1.5}}>{c.description}{!c.found&&<span style={{color:T.textMut}}> (missed — in {c.room})</span>}</div></div>
          </div>)}
        </div>}
        {tab==="votes"&&<div>
          <div className="section-label" style={{marginBottom:10}}>Team Votes</div>
          {Object.keys(verdict.teamVotes||{}).length===0&&<p style={{color:T.textMut,fontSize:13}}>No votes cast.</p>}
          {Object.entries(verdict.teamVotes||{}).map(([pid,sid])=>{const p=(verdict.players||[]).find(x=>x.id.toString()===pid)||{name:"Player",color:T.cyan};const s=caseData.suspects.find(x=>x.id===sid)||{name:"Unknown",guilty:false};return(
            <div key={pid} style={{display:"flex",gap:10,alignItems:"center",marginBottom:9,padding:"8px 11px",background:T.bg2,borderRadius:8,border:`1px solid ${s.guilty?T.green:T.red}22`}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:p.color}}/><span style={{fontSize:13,flex:1}}>{p.name}</span><span style={{fontSize:12,color:T.textSec}}>→ {s.name}</span><span className={`tag ${s.guilty?"tag-green":"tag-red"}`} style={{fontSize:9}}>{s.guilty?"CORRECT":"WRONG"}</span>
            </div>
          );})}
        </div>}
        <div style={{display:"flex",gap:9,marginTop:14}}>
          <button className="btn btn-cyan" style={{flex:1,justifyContent:"center"}} onClick={()=>onEnd("lobby")}>Play Again</button>
          <button className="btn btn-ghost" onClick={()=>onEnd("home")}>Menu</button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// APP ROOT
// ============================================================
export default function App(){
  const [screen,setScreen]=useState("home");
  const [gameState,setGameState]=useState(null);
  const [settings,setSettings]=useState({openaiKey:"",openaiModel:"gpt-4o",elevenLabsKey:"",elevenLabsVoiceId:"",aiHints:true,voiceEnabled:false,lieDetector:true,narratorEnabled:true,showDevLog:true});
  useEffect(()=>{logger.info("APP","CaseZero v1.4 init",{model:settings.openaiModel});},[]);
  const handleEnd=useCallback((dest)=>{logger.info("APP",`→ ${dest}`);setGameState(null);setScreen(dest||"home");},[]);
  return(
    <>
      <style>{css}</style>
      <div className="scanlines">
        <div className="nav">
          <span className="logo-text" style={{cursor:"pointer"}} onClick={()=>setScreen("home")}>CASE<span className="logo-accent">ZERO</span></span>
          <div style={{display:"flex",gap:7,alignItems:"center"}}>
            {!settings.openaiKey&&screen!=="settings"&&<span style={{fontSize:11,color:T.amber}}>⚠ No API key</span>}
            <span style={{fontSize:10,color:T.textMut,fontFamily:"'Space Mono',monospace"}}>v1.4</span>
            <button className="btn btn-ghost" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setScreen("settings")}>⚙</button>
          </div>
        </div>
        {screen==="home"    &&<LandingScreen onStart={setScreen}/>}
        {screen==="settings"&&<SettingsScreen settings={settings} onChange={setSettings} onBack={()=>setScreen("home")}/>}
        {screen==="tutorial"&&<TutorialWrapper settings={settings} onDone={()=>setScreen("home")}/>}
        {screen==="lobby"   &&<LobbyScreen settings={settings} onGameStart={gs=>{logger.info("APP","Game start",{case:gs.caseData.id,diff:gs.difficulty});setGameState(gs);setScreen("game");}} onBack={()=>setScreen("home")}/>}
        {screen==="game"&&gameState&&<GameScreen gameState={gameState} settings={settings} onEnd={handleEnd}/>}
      </div>
      {settings.showDevLog&&<LogPanel/>}
    </>
  );
}
