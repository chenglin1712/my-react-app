import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const load = async () => {
  vi.resetModules();
  const store = await import("@/theme/themeStore");
  const ui = await import("./ThemeSettings");
  return { store, ...ui };
};

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  vi.stubEnv("VITE_ENABLE_DARK_THEME", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ThemeRadioGroup", () => {
  test("單選群組：標題「顯示設定」，淺色、深色、跟隨裝置三個選項，預設選淺色", async () => {
    const { ThemeRadioGroup } = await load();
    render(<ThemeRadioGroup />);
    expect(screen.getByRole("group", { name: "顯示設定" })).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.value)).toEqual(["light", "dark", "system"]);
    expect(screen.getByRole("radio", { name: "淺色" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "深色" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "跟隨裝置" })).not.toBeChecked();
  });

  test("選深色：寫入儲存空間與 <html data-theme>", async () => {
    const { ThemeRadioGroup } = await load();
    const user = userEvent.setup();
    render(<ThemeRadioGroup />);
    await user.click(screen.getByRole("radio", { name: "深色" }));
    expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
    expect(window.localStorage.getItem("yy-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  test("鍵盤：方向鍵在選項間移動並選取", async () => {
    const { ThemeRadioGroup } = await load();
    const user = userEvent.setup();
    render(<ThemeRadioGroup />);
    screen.getByRole("radio", { name: "淺色" }).focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "跟隨裝置" })).toBeChecked();
    expect(document.documentElement.getAttribute("data-theme")).toBe("system");
  });

  test("兩組（桌面面板與手機抽屜）共用同一份狀態，且 name 不同、互不影響", async () => {
    const { ThemeRadioGroup } = await load();
    const user = userEvent.setup();
    render(<><ThemeRadioGroup /><ThemeRadioGroup /></>);
    const dark = screen.getAllByRole("radio", { name: "深色" });
    expect(dark[0].name).not.toBe(dark[1].name);
    await user.click(dark[0]);
    expect(dark[0]).toBeChecked();
    expect(dark[1]).toBeChecked();
  });

  test("儲存值損壞時顯示淺色", async () => {
    window.localStorage.setItem("yy-theme", "???");
    const { ThemeRadioGroup } = await load();
    render(<ThemeRadioGroup />);
    expect(screen.getByRole("radio", { name: "淺色" })).toBeChecked();
  });

  test("別的分頁改了偏好，選取狀態跟著變", async () => {
    const { ThemeRadioGroup } = await load();
    render(<ThemeRadioGroup />);
    act(() => {
      window.localStorage.setItem("yy-theme", "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: "yy-theme", newValue: "dark" }));
    });
    expect(screen.getByRole("radio", { name: "深色" })).toBeChecked();
  });
});

describe("ThemeMenu（桌面導覽列）", () => {
  test("旗標沒開時整個不顯示", async () => {
    vi.stubEnv("VITE_ENABLE_DARK_THEME", "");
    const { ThemeMenu } = await load();
    const { container } = render(<ThemeMenu />);
    expect(container).toBeEmptyDOMElement();
  });

  test("按鈕有名稱、預設收起（面板 inert）、aria-expanded 與 aria-controls 對得上", async () => {
    const { ThemeMenu } = await load();
    render(<ThemeMenu />);
    const trigger = screen.getByRole("button", { name: "顯示設定" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("inert");
    expect(panel).not.toHaveClass("active");
  });

  test("點按鈕展開、再點收起", async () => {
    const { ThemeMenu } = await load();
    const user = userEvent.setup();
    render(<ThemeMenu />);
    const trigger = screen.getByRole("button", { name: "顯示設定" });
    await user.click(trigger);
    const panel = document.getElementById(trigger.getAttribute("aria-controls"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(panel).toHaveClass("active");
    expect(panel).not.toHaveAttribute("inert");
    await user.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  test("選項上按下滑鼠不會讓面板在 click 之前收起（真實滑鼠先讓焦點掉到 body 的情況）", async () => {
    const { ThemeMenu } = await load();
    const user = userEvent.setup();
    render(<ThemeMenu />);
    await user.click(screen.getByRole("button", { name: "顯示設定" }));
    await user.click(screen.getByText("深色"));
    expect(window.localStorage.getItem("yy-theme")).toBe("dark");
    expect(screen.getByRole("button", { name: "顯示設定" })).toHaveAttribute("aria-expanded", "true");
  });

  test("Esc 收起並把焦點還給按鈕", async () => {
    const { ThemeMenu } = await load();
    const user = userEvent.setup();
    render(<ThemeMenu />);
    const trigger = screen.getByRole("button", { name: "顯示設定" });
    await user.click(trigger);
    screen.getByRole("radio", { name: "淺色" }).focus();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveFocus();
  });

  test("點面板外面收起；焦點移到面板外也收起", async () => {
    const { ThemeMenu } = await load();
    const user = userEvent.setup();
    render(<><button type="button">外面的按鈕</button><ThemeMenu /></>);
    const trigger = screen.getByRole("button", { name: "顯示設定" });
    await user.click(trigger);
    await user.click(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    await user.click(trigger);
    act(() => screen.getByRole("button", { name: "外面的按鈕" }).focus());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
