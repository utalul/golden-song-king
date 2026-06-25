export default function Button({
  children,
  onClick,
  type = "button",
  disabled = false,
  variant = "primary",
  className = ""
}) {

  const variants = {
    primary:
      "bg-violet-600 hover:bg-violet-500",

    success:
      "bg-emerald-600 hover:bg-emerald-500",

    warning:
      "bg-amber-500 hover:bg-amber-400",

    danger:
      "bg-red-600 hover:bg-red-500"
  };

  return (

    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`
        w-full
        rounded-2xl
        py-4
        text-lg
        font-bold
        text-white
        transition-all
        duration-200
        active:scale-95
        disabled:opacity-50
        disabled:cursor-not-allowed
        shadow-lg
        ${variants[variant]}
        ${className}
      `}
    >
      {children}
    </button>

  );

}