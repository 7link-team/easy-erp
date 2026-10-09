import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useRef,
  useId,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type TextareaHTMLAttributes,
  type SelectHTMLAttributes,
  type FormHTMLAttributes,
  type ReactNode,
  type ComponentProps,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import * as Dialog from "@radix-ui/react-dialog";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { Check, ChevronDown, X } from "lucide-react";

export function Disclosure({
  title,
  children,
  className = "",
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <Button
        className="ui-disclosure-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
      >
        <ChevronDown size={17} />
        {title}
      </Button>
      <div id={id} hidden={!open}>
        {children}
      </div>
    </div>
  );
}

export function Button({
  className = "button",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type={type} className={`ui-button ${className}`} />;
}

export function Tabs(props: ComponentProps<typeof TabsPrimitive.Root>) {
  return <TabsPrimitive.Root {...props} />;
}
export function TabsList({
  className = "",
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List {...props} className={`ui-tabs-list ${className}`} />
  );
}
export function Tab({
  className = "",
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger {...props} className={`ui-tab ${className}`} />;
}
export function TabsPanel({
  className = "",
  ...props
}: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      {...props}
      className={`ui-tabs-panel ${className}`}
    />
  );
}

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  const errors = useContext(ValidationContext);
  return (
    <input
      {...props}
      aria-invalid={!!errors[props.id ?? ""] || undefined}
      className={`ui-input ${className}`}
    />
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const errors = useContext(ValidationContext);
  return (
    <textarea
      {...props}
      aria-invalid={!!errors[props.id ?? ""] || undefined}
      className={`ui-input ui-textarea ${className}`}
    />
  );
}

type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "onChange" | "value" | "defaultValue"
> & {
  value?: string | number;
  onChange?: (event: { target: { value: string } }) => void;
};
const EMPTY_OPTION = "__erp_empty_option__";
export function Select({
  children,
  value,
  onChange,
  id,
  className = "",
  disabled,
  required,
  name,
  ...props
}: SelectProps) {
  const errors = useContext(ValidationContext);
  const clearError = useContext(ClearValidationContext);
  const options = Children.toArray(children).filter(
    isValidElement<{
      value?: string | number;
      children: ReactNode;
      disabled?: boolean;
    }>,
  );
  return (
    <SelectPrimitive.Root
      value={String(value ?? "") || EMPTY_OPTION}
      disabled={disabled}
      required={required}
      name={name}
      onValueChange={(value) => {
        clearError(id ?? "");
        onChange?.({ target: { value: value === EMPTY_OPTION ? "" : value } });
      }}
    >
      <SelectPrimitive.Trigger
        id={id}
        className={`ui-select ${className}`}
        aria-label={props["aria-label"]}
        aria-describedby={props["aria-describedby"]}
        aria-required={required}
        aria-invalid={errors[id ?? ""] ? true : props["aria-invalid"]}
        data-value={value}
      >
        <SelectPrimitive.Value />
        <SelectPrimitive.Icon>
          <ChevronDown size={18} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => {
              const text = option.props.children;
              const key = String(option.props.value ?? text);
              return (
                <SelectPrimitive.Item
                  className="ui-select-option"
                  data-value={key}
                  key={key}
                  value={key || EMPTY_OPTION}
                  disabled={option.props.disabled}
                >
                  <SelectPrimitive.ItemText>{text}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator>
                    <Check size={16} />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

type CheckboxProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange"
> & { onChange?: (event: { target: { checked: boolean } }) => void };
export function Checkbox({
  checked,
  onChange,
  id,
  disabled,
  required,
  name,
  className = "",
  ...props
}: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      id={id}
      checked={checked}
      disabled={disabled}
      required={required}
      name={name}
      aria-label={props["aria-label"]}
      aria-describedby={props["aria-describedby"]}
      className={`ui-checkbox ${className}`}
      onCheckedChange={(value) =>
        onChange?.({ target: { checked: value === true } })
      }
    >
      <CheckboxPrimitive.Indicator>
        <Check size={15} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export function Modal({
  title,
  children,
  onClose,
  variant,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  variant?: "print";
}) {
  const opener = useRef(document.activeElement);
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="ui-dialog-overlay" />
        <Dialog.Content
          className={`ui-dialog ${variant === "print" ? "sales-print-overlay" : ""}`}
          aria-describedby={undefined}
          onPointerDownOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            if (
              opener.current instanceof HTMLElement &&
              opener.current.isConnected
            )
              opener.current.focus();
          }}
        >
          <div
            className={
              variant === "print" ? "print-dialog-heading" : "modal-heading"
            }
          >
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <Button className="icon-button" aria-label="关闭">
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ValidationContext = createContext<Record<string, string>>({});
const ClearValidationContext = createContext<(id: string) => void>(() => {});

export function Form({
  onSubmit,
  children,
  ...props
}: FormHTMLAttributes<HTMLFormElement>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const clearError = useCallback((id: string) => {
    setErrors((values) => {
      const next = { ...values };
      delete next[id];
      return next;
    });
  }, []);
  return (
    <ClearValidationContext.Provider value={clearError}>
      <ValidationContext.Provider value={errors}>
        <form
          {...props}
          noValidate
          onChange={(e) => clearError((e.target as HTMLElement).id)}
          onSubmit={(event) => {
            const errors: Record<string, string> = {};
            let first: HTMLElement | undefined;
            for (const el of event.currentTarget.elements) {
              if (
                !(
                  el instanceof HTMLInputElement ||
                  el instanceof HTMLTextAreaElement
                ) ||
                el.disabled ||
                el.type === "hidden" ||
                el.validity.valid
              )
                continue;
              errors[el.id] = el.validity.valueMissing
                ? "请填写此项。"
                : el.validity.rangeUnderflow
                  ? `不能小于 ${el.getAttribute("min")}。`
                  : el.validity.rangeOverflow
                    ? `不能大于 ${el.getAttribute("max")}。`
                    : "填写格式不正确，请按提示修改。";
              first ??= el;
            }
            for (const select of event.currentTarget.querySelectorAll<HTMLElement>(
              '[role="combobox"][aria-required="true"]',
            )) {
              if (!select.matches(":disabled") && !select.dataset.value) {
                errors[select.id] = "请选择此项。";
              }
            }
            first = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                'input,textarea,[role="combobox"]',
              ),
            ).find((el) => errors[el.id]);
            setErrors(errors);
            if (first) {
              event.preventDefault();
              first.focus();
              return;
            }
            onSubmit?.(event);
          }}
        >
          {children}
        </form>
      </ValidationContext.Provider>
    </ClearValidationContext.Provider>
  );
}

type Confirmation = {
  title: string;
  description: string;
  confirmLabel?: string;
  danger?: boolean;
};
const ConfirmContext = createContext<
  (options: Confirmation) => Promise<boolean>
>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Confirmation>();
  const resolve = useRef<(value: boolean) => void>(undefined);
  const confirm = useCallback(
    (options: Confirmation) =>
      new Promise<boolean>((done) => {
        resolve.current?.(false);
        resolve.current = done;
        setPending(options);
      }),
    [],
  );
  const finish = (value: boolean) => {
    resolve.current?.(value);
    resolve.current = undefined;
    setPending(undefined);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <Modal title={pending.title} onClose={() => finish(false)}>
          <p>{pending.description}</p>
          <div className="form-actions">
            <Button autoFocus onClick={() => finish(false)}>
              取消
            </Button>
            <Button
              className={`button ${pending.danger ? "danger" : "primary"}`}
              onClick={() => finish(true)}
            >
              {pending.confirmLabel ?? "确认"}
            </Button>
          </div>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}
