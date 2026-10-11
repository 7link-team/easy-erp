import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useCallback,
  useEffect,
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
import { Check, ChevronDown, Plus, X } from "lucide-react";

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
        <ChevronDown aria-hidden="true" size={17} />
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
      name={props.name ?? props.id}
      autoComplete={props.autoComplete ?? "off"}
      aria-invalid={errors[props.id ?? ""] ? true : props["aria-invalid"]}
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
      name={props.name ?? props.id}
      autoComplete={props.autoComplete ?? "off"}
      aria-invalid={errors[props.id ?? ""] ? true : props["aria-invalid"]}
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
  createLabel?: string;
  onCreate?: () => void;
};
const EMPTY_OPTION = "__erp_empty_option__";
const CREATE_OPTION = "__erp_create_option__";
export function Select({
  children,
  value,
  onChange,
  id,
  className = "",
  disabled,
  required,
  name,
  createLabel,
  onCreate,
  ...props
}: SelectProps) {
  const creating = useRef(false);
  const errors = useContext(ValidationContext);
  const clearError = useContext(ClearValidationContext);
  useEffect(() => {
    if (value) clearError(id ?? "");
  }, [value, id, clearError]);
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
      name={name ?? id}
      onValueChange={(value) => {
        // Radix's hidden native select can emit an empty value while new options
        // register. Our actual empty choice uses EMPTY_OPTION, so ignore that event.
        if (value === "") return;
        if (value === CREATE_OPTION && onCreate) {
          creating.current = true;
          return;
        }
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
          <ChevronDown size={18} aria-hidden="true" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          className="ui-select-menu"
          position="popper"
          sideOffset={6}
          collisionPadding={12}
          onCloseAutoFocus={(event) => {
            if (creating.current) {
              creating.current = false;
              event.preventDefault();
              document.getElementById(id ?? "")?.focus();
              onCreate?.();
            }
          }}
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
                    <Check size={16} aria-hidden="true" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
            {onCreate && createLabel && (
              <SelectPrimitive.Item
                value={CREATE_OPTION}
                className="ui-select-option ui-select-create"
              >
                <Plus size={16} aria-hidden="true" />
                <SelectPrimitive.ItemText>
                  {createLabel}
                </SelectPrimitive.ItemText>
              </SelectPrimitive.Item>
            )}
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
        <Check aria-hidden="true" size={15} strokeWidth={3} />
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
          onEscapeKeyDown={(e) => {
            if (
              document.activeElement?.matches(
                '[role="combobox"][aria-expanded="true"]',
              )
            )
              e.preventDefault();
          }}
          onPointerDownOutside={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const target = opener.current;
            if (target instanceof HTMLElement && target.isConnected)
              target.focus();
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
                <X size={20} aria-hidden="true" />
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
            // A child dialog rendered through a portal must not submit its parent form.
            event.stopPropagation();
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
          <div className="form-actions form-footer">
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

/** Editable suggestions. Values are persisted by the surrounding business form. */
export function ComboBox({
  options,
  value = "",
  onValueChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string;
  options: { value: string; label: string }[];
  onValueChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && active >= 0)
      list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);
  const clearError = useContext(ClearValidationContext);
  const selected = options.find((o) => o.value === value);
  const shown = selected
    ? options
    : options.filter((o) =>
        o.label.toLowerCase().includes(value.toLowerCase()),
      );
  const choose = (next: string) => {
    onValueChange(next);
    if (props.id) clearError(props.id);
    setOpen(false);
    setActive(-1);
  };
  return (
    <div
      className="ui-combobox"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Input
        {...props}
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={
          open && active >= 0 ? `${listId}-${active}` : undefined
        }
        value={selected?.label ?? value}
        onClick={() => {
          setOpen(true);
          setActive(-1);
        }}
        onChange={(e) => {
          onValueChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
            setActive((n) =>
              shown.length
                ? n < 0
                  ? e.key === "ArrowDown"
                    ? 0
                    : shown.length - 1
                  : (n + (e.key === "ArrowDown" ? 1 : -1) + shown.length) %
                    shown.length
                : -1,
            );
          }
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
          }
          if (e.key === "Enter" && open && active >= 0 && shown[active]) {
            e.preventDefault();
            choose(shown[active].value);
          }
        }}
      />
      <Button
        className="ui-combobox-toggle icon-button"
        aria-label="展开候选选项"
        disabled={props.disabled}
        tabIndex={-1}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          setOpen(!open);
          setActive(-1);
        }}
      >
        <ChevronDown aria-hidden="true" size={17} />
      </Button>
      {open && (
        <div
          ref={list}
          className="ui-combobox-list"
          role="listbox"
          id={listId}
          aria-label="候选选项"
        >
          {shown.map((o, i) => (
            <Button
              key={o.value}
              className="ui-combobox-option"
              role="option"
              tabIndex={-1}
              data-value={o.value}
              id={`${listId}-${i}`}
              aria-selected={active >= 0 ? active === i : o.value === value}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(o.value)}
            >
              {o.label}
            </Button>
          ))}
          {!selected &&
            value.trim() &&
            !shown.some(
              (o) =>
                o.label.trim().toLowerCase() === value.trim().toLowerCase(),
            ) && <p className="muted">保存时新增“{value.trim()}”</p>}
          {!shown.length && !value.trim() && (
            <p className="muted">可直接输入新选项</p>
          )}
        </div>
      )}
    </div>
  );
}
