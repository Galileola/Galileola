import 'dotenv/config';
import express from 'express';
import cors from 'cors';
const app=express();
app.use(cors());
app.use(express.json({limit:'12kb'}));
app.get('/health',(_,res)=>res.json({ok:true}));
app.post('/coach',async(req,res)=>{
  const {message,language}=req.body||{};
  if(typeof message!=='string'||message.trim().length<2||message.length>2000||!['en','ru','et'].includes(language))return res.status(400).json({error:'Invalid request'});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({error:'Server AI key not configured'});
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Authorization':`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',instructions:`You are SPEAK POWER, a supportive communication coach. Respond in ${language==='ru'?'Russian':language==='et'?'Estonian':'English'}. Assess the user's response to criticism: "Your idea will never work." Give concise, specific feedback on clarity, calmness, confidence and respect, followed by one improved example. Do not encourage aggression or manipulation. Under 130 words.`,input:message,max_output_tokens:260})});
    if(!response.ok)throw new Error('AI provider error');
    const data=await response.json();
    const feedback=(data.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');
    if(!feedback)return res.status(502).json({error:'Empty coach response'});
    res.json({feedback});
  }catch(e){console.error('Coach request failed:',e.message);res.status(502).json({error:'Coach temporarily unavailable'});}
});
app.listen(Number(process.env.PORT)||3000,()=>console.log('SPEAK POWER coach server listening'));
