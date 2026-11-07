import React, { useState } from 'react';
import { supabase } from '../supabaseClient.js';
import { WorkflowRecipeCard } from './WorkflowRecipePanel.jsx';
import { preparationSteps } from './documentRecipe.js';
import { workflowRecipe } from './workflowRecipe.js';
export default function RecipeUpload({ clientId, onDraft, demo }) {
  const [file,setFile]=useState(null),[source,setSource]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const generate=async()=>{
    setBusy(true);setError('');setSource(null);
    try {
      if(!file || file.size>8*1024*1024)throw new Error('Choose a PDF, .docx or text file smaller than 8 MB.');
      const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const {data:{session}}=await supabase.auth.getSession();
      const response=await fetch('/api/local-n8n/upload',{method:'POST',headers:{Authorization:`Bearer ${session?.access_token||''}`,'Content-Type':'application/json'},body:JSON.stringify({clientId,filename:file.name,content:btoa(binary)})});
      if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('Start the local dashboard server to upload recipes.');
      const data=await response.json();if(!response.ok)throw new Error(data.error);setSource(data.sourceRecipe);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  const download=async()=>{
    setBusy(true);setError('');try{
      const draft=workflowRecipe(source).draft;
      const {downloadRecipePdf}=await import('./recipePdf.js');
      await downloadRecipePdf({project:{name:'Uploaded recipe review',serviceDate:'not scheduled',serviceTime:'',yieldActuals:{}},status:'draft',recipes:[{id:'upload-preview',status:'draft',version_number:1,recipe_json:draft}],recipeTargets:[{id:'upload-preview',scale:1,quantity:draft.yield.quantity}]});
    }catch(e){setError(e.message);}finally{setBusy(false);}
  };
  return <section className="op-workflow-intake"><p className="op-eyebrow">Step 1 · Recipe intake</p><h2>Upload your recipe</h2><p>Upload a PDF or Word document to create a standardised recipe.</p><label>Recipe document<input type="file" accept=".pdf,.docx,.txt,.md" disabled={busy||demo} onChange={e=>{setFile(e.target.files[0]||null);setSource(null);setError('');}}/></label><p className="op-upload-hint">PDF or .docx · One recipe · Up to 8 MB</p><details className="op-upload-help"><summary>Which files work best?</summary><p>Use a text PDF or Word document with Ingredients and Method headings. Scanned PDFs need OCR. Check unrecognised rows against the source.</p></details><button className="op-primary" disabled={!file||busy||demo} onClick={generate}>{busy?'Processing…':'Generate standardised recipe'}</button>{demo&&<p>Sign in to your connected kitchen to upload your documents.</p>}<p role="status">{error}</p>{source&&<><WorkflowRecipeCard source={source}/><details><summary>Compare extracted source text</summary><pre className="op-source-method">{source.source_text}</pre></details><div className="op-actions"><button disabled={busy} onClick={download}>Download draft recipe PDF</button><button onClick={()=>onDraft({...workflowRecipe(source).draft,production_steps:preparationSteps(workflowRecipe(source).method)})}>Review & save recipe</button></div><p>Next: confirm recipe quantities and production timings, save for review, then add the approved recipe to your prep schedule.</p></>}</section>;
}
