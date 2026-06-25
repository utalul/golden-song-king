export default function Page({

  children

}) {

  return (

    <div
      className="
        min-h-screen

        bg-gradient-to-b

        from-violet-950

        via-slate-900

        to-black

        text-white
      "
    >

      <div
        className="
          mx-auto
          max-w-md
          p-6
        "
      >

        {children}

      </div>

    </div>

  );

}