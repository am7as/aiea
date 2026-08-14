import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Circle, Polygon, Rectangle

def draw_counter(n, clk_label, out_path):
    W, H = 1.45, 1.6
    gap = 2.7
    stubL = 0.8
    stubR = 0.55
    bub = 0.08          # clock bubble (negation)
    tri = 0.20          # dynamic-input triangle depth (edge-trigger marker)
    lw = 1.7
    y0 = 0.0
    yJ, yCK, yK = y0 + H*0.77, y0 + H*0.50, y0 + H*0.23
    box_lefts = [stubL + i*(W+gap) for i in range(n)]
    fig, ax = plt.subplots(figsize=((box_lefts[-1]+W+stubR+1.3)*0.85, 2.4))
    for i in range(n):
        bl = box_lefts[i]; brx = bl + W
        ax.add_patch(Rectangle((bl, y0), W, H, fill=False, lw=lw))
        ax.text(bl+W/2, y0+H+0.13, "FF%d" % (i+1), ha="center", va="bottom", fontsize=13)
        ax.text(bl+0.13, yJ, "J", ha="left", va="center", fontsize=13)
        ax.text(bl+tri+0.16, yCK, "CK", ha="left", va="center", fontsize=13)
        ax.text(bl+0.13, yK, "K", ha="left", va="center", fontsize=13)
        ax.text(brx-0.13, yCK, "Q", ha="right", va="center", fontsize=13)
        ax.plot([bl-stubL, bl], [yJ, yJ], "k", lw=lw)
        ax.plot([bl-stubL, bl], [yK, yK], "k", lw=lw)
        ax.text(bl-stubL-0.06, yJ, "1", ha="right", va="center", fontsize=12)
        ax.text(bl-stubL-0.06, yK, "1", ha="right", va="center", fontsize=12)
        # clock: wire -> negation bubble (outside) -> dynamic-input triangle (inside)
        ax.plot([bl-stubL, bl-2*bub], [yCK, yCK], "k", lw=lw)
        ax.add_patch(Circle((bl-bub, yCK), bub, fill=False, lw=lw))
        ax.add_patch(Polygon([(bl, yCK+0.14), (bl, yCK-0.14), (bl+tri, yCK)],
                             closed=True, fill=False, lw=lw))
        ax.plot([brx, brx+stubR], [yCK, yCK], "k", lw=lw)
    for i in range(n-1):
        x_out = box_lefts[i]+W+stubR
        x_in = box_lefts[i+1]-stubL
        ax.plot([x_out, x_in], [yCK, yCK], "k", lw=lw)
        ax.text(x_out+0.15, yCK+0.14, r"$Q_{%d}$" % (i+1), ha="left", va="bottom", fontsize=13)
    ax.text(box_lefts[0]-stubL-0.06, yCK, clk_label, ha="right", va="center", fontsize=12)
    ax.text(box_lefts[-1]+W+stubR+0.1, yCK, r"$Q_{%d}$" % n, ha="left", va="center", fontsize=13)
    ax.set_xlim(box_lefts[0]-stubL-1.1, box_lefts[-1]+W+stubR+1.2)
    ax.set_ylim(y0-0.35, y0+H+0.55)
    ax.set_aspect("equal"); ax.axis("off")
    fig.savefig(out_path, dpi=300, bbox_inches="tight", pad_inches=0.12)
    plt.close(fig)

base = "/Users/yourname/Downloads/test/claude-test-playground/figredraw/"
draw_counter(2, "CLK", base+"circuit_B.png")
draw_counter(3, "Input", base+"circuit_C.png")
print("done")
