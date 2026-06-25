export default function Card({

  children,

  className = ""

}) {

  return (

    <div
      className={`
        rounded-3xl
        bg-slate-800/90
        border
        border-slate-700
        p-6
        shadow-xl
        backdrop-blur
        ${className}
      `}
    >

      {children}

    </div>

  );

}