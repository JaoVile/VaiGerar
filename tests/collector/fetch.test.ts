import { describe, expect, it, vi } from "vitest";
import { channelPageUrl, fetchChannelPage } from "@/lib/collector/fetch";

describe("channelPageUrl", () => {
  it("monta a url do canal", () => {
    expect(channelPageUrl("gtOFERTAS")).toBe("https://t.me/s/gtOFERTAS");
  });
  it("acrescenta o cursor de paginação", () => {
    expect(channelPageUrl("gtOFERTAS", 147663)).toBe("https://t.me/s/gtOFERTAS?before=147663");
  });
});

describe("fetchChannelPage", () => {
  it("devolve o corpo quando a resposta é 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("<html>ok</html>", { status: 200 }));
    await expect(fetchChannelPage("x", undefined, { fetchFn })).resolves.toBe("<html>ok</html>");
  });

  it("lança erro identificando o canal quando a resposta não é 200", async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));
    await expect(fetchChannelPage("sumido", undefined, { fetchFn })).rejects.toThrow(/sumido.*404/);
  });
});
