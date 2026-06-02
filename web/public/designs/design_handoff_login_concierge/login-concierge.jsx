// 02 - Concierge (stripped)
// Just the soft ambient background and the centered glass card. No top nav,
// no floating preview panels - quiet and minimal.

function LoginConcierge() {
  return (
    <div style={{
      position:'relative', width:'100%', height:'100%', overflow:'hidden',
      background:'radial-gradient(120% 80% at 50% 0%, #EFE9FB 0%, #FAF7F2 55%, #F3EEE5 100%)',
    }}>
      {/* Soft blobs */}
      <div style={{
        position:'absolute', width:760, height:760, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(232,180,160,0.45) 0%, rgba(232,180,160,0) 70%)',
        left:-180, bottom:-300, filter:'blur(20px)',
      }}/>
      <div style={{
        position:'absolute', width:600, height:600, borderRadius:'50%',
        background:'radial-gradient(circle, rgba(108,61,217,0.18) 0%, rgba(108,61,217,0) 70%)',
        right:-160, top:-200, filter:'blur(20px)',
      }}/>

      {/* Center form */}
      <div style={{
        position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', zIndex:3,
      }}>
        <div style={{
          width:420, padding:'40px 36px 32px',
          background:'rgba(255,253,250,0.86)', backdropFilter:'blur(18px) saturate(140%)',
          WebkitBackdropFilter:'blur(18px) saturate(140%)',
          border:'1px solid rgba(255,255,255,0.9)',
          borderRadius:24,
          boxShadow:'0 30px 80px -20px rgba(26,22,32,0.25), 0 2px 0 rgba(255,255,255,0.6) inset',
        }}>
          <div style={{ display:'flex', justifyContent:'center', marginBottom:18 }}>
            <div style={{
              width:60, height:60, borderRadius:18, background:'var(--brand-soft)',
              display:'flex', alignItems:'center', justifyContent:'center',
              border:'1px solid rgba(108,61,217,0.18)',
            }}>
              <HouseGlyph size={32} color="var(--brand)"/>
            </div>
          </div>

          <h2 className="serif" style={{ margin:0, fontSize:40, lineHeight:1.05, textAlign:'center', letterSpacing:'-0.02em' }}>
            Welcome <span className="serif-i" style={{ color:'var(--brand)' }}>home.</span>
          </h2>
          <p style={{ margin:'10px 0 24px', textAlign:'center', fontSize:13, color:'var(--ink-2)', lineHeight:1.5 }}>
            Mia &amp; 2 others are signed in. Join them.
          </p>

          <AuthButtons variant="light"/>

          <div style={{ marginTop:20, textAlign:'center', fontSize:13, color:'var(--ink-2)' }}>
            New to Housemait? <a style={{
              color:'var(--brand-deep)', fontWeight:700, textDecoration:'none',
              borderBottom:'1.5px solid var(--brand-deep)', paddingBottom:1,
            }}>Create an account →</a>
          </div>

          <div style={{ marginTop:14, textAlign:'center', fontSize:12, color:'var(--ink-3)' }}>
            By continuing, you agree to our <a style={{ color:'var(--ink-2)' }}>Terms</a>.
          </div>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { LoginConcierge });
