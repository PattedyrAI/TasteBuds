export async function register(){
  if(process.env.NEXT_RUNTIME==='nodejs' && process.env.DATABASE_URL){
    const {processDiscordOutbox}=await import('./server/discord');
    const timer=setInterval(()=>{processDiscordOutbox().catch(()=>console.error('Discord queue check failed.'));},15_000);
    timer.unref();
  }
}
