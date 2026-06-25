export default function Input({

  value,

  onChange,

  placeholder,

  type = "text",

  disabled = false

}) {

  return (

    <input

      type={type}

      value={value}

      onChange={onChange}

      placeholder={placeholder}

      disabled={disabled}

      className="
        w-full
        rounded-2xl
        border
        border-slate-700
        bg-slate-900
        px-4
        py-4
        text-lg
        text-white
        placeholder:text-slate-500
        outline-none
        focus:border-violet-500
        disabled:cursor-not-allowed
        disabled:opacity-50
      "

    />

  );

}
