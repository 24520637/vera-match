"use client";
import { useId, useState } from "react";
import { Input } from "../ui/form";
import { Button } from "../ui/button";
export function PasswordInput(
  props: Omit<Parameters<typeof Input>[0], "type">,
) {
  const generated = useId();
  const id = props.id ?? generated;
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <Input {...props} id={id} type={visible ? "text" : "password"} />
      <Button
        variant="quiet"
        size="small"
        aria-controls={id}
        aria-pressed={visible}
        onClick={() => setVisible(!visible)}
        disabled={props.disabled}
      >
        {visible ? "Hide password" : "Show password"}
      </Button>
    </div>
  );
}
