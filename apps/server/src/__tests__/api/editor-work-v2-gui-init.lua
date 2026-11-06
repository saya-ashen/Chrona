vim.opt.runtimepath:prepend("/home/saya/workspace/agent-workbench.nvim")
vim.opt.runtimepath:prepend("/nix/store/2r6bw0y0ar6cknh2cg93q7fc6ah0xmwf-plenary-nvim-74b06c6c")
vim.opt.shadafile = "NONE"
vim.opt.termguicolors = true
vim.opt.title = false
local source = vim.fn.bufadd(vim.env.CHRONA_U_GUI_ROOT .. "/project/answer.txt")
vim.fn.bufload(source)
vim.bo[source].modified = true
require("agent-workbench").setup({
    backend = "chrona",
    backend_options = { url = vim.env.CHRONA_U_GUI_URL, project_ref = "gui-project", api_key = function() return "synthetic-u-final-gui" end },
    render = { markdown = { enabled = false } },
    attention = { notify_on_completion = false },
    prompt = { history = { enabled = false }, draft = { enabled = false } },
})
vim.schedule(function() require("agent-workbench").show({layout="buffer"}) end)
