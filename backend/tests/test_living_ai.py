"""模型运行边界与活页上下文，不触发真实模型请求。"""
import pytest

from app.ppt_ai.page_lab import PageLabError, dry_run, EXAMPLE_PROGRAM


def test_model_probe_blocks_computed_dynamic_code():
    program = "function render(input){input['con'+'structor']['con'+'structor']('return 42')();return {version:'ppt-ai.view.1',width:720,height:420,interactions:[],nodes:[]};}"
    with pytest.raises(PageLabError):
        dry_run(program, [{"id": "temp", "min": 0.1, "max": 3, "default": 1}])


def test_existing_attention_program_still_runs_at_parameter_boundaries():
    dry_run(EXAMPLE_PROGRAM, [{"id": "temp", "min": 0.1, "max": 3, "default": 1}])


@pytest.mark.parametrize("expression", ["NaN", "Infinity"])
def test_model_probe_rejects_nonfinite_values(expression):
    with pytest.raises(PageLabError, match="NaN/Infinity"):
        dry_run("function render(input){return {version:'ppt-ai.view.1',width:" + expression +
                ",height:420,interactions:[],nodes:[]};}", [])


def test_model_probe_stops_loop_even_inside_output_getter():
    with pytest.raises(PageLabError, match="timed out"):
        dry_run("function render(input){return {get nodes(){for(var i=0;i<1e12;i++){};return [];}};}", [])


def test_context_uses_edited_text_and_neighbour_pages():
    from app.living.ai import model_context
    blocks = [
        {"id": "s", "type": "section", "data": {"heading": "位置编码"}},
        {"id": "p", "type": "text", "source": {"file_id": "f1", "page": 1}, "data": {"md": "前页位置编码说明"}},
        {"id": "b", "type": "text", "source": {"file_id": "f1", "page": 2}, "data": {"md": "修订后的正弦位置编码内容"}},
        {"id": "n", "type": "text", "source": {"file_id": "f1", "page": 3}, "data": {"md": "后页编码频率说明"}},
    ]
    context, key = model_context({"title": "课程", "blocks": blocks}, "b", "观察频率")
    assert context["page_text"] == "修订后的正弦位置编码内容"
    assert context["page_title"] == "位置编码"
    assert context["neighbour_text"] == ["前页位置编码说明", "后页编码频率说明"]
    assert model_context({"title": "课程", "blocks": blocks}, "b", "观察频率")[1] == key
    blocks[2]["data"]["md"] += "新内容"
    assert model_context({"title": "课程", "blocks": blocks}, "b", "观察频率")[1] != key


def test_generation_instructions_include_required_curve_domain():
    from app.ppt_ai.page_lab import OUTPUT_CONTRACT
    curve_line = next(line for line in OUTPUT_CONTRACT.splitlines() if "type:'curve'" in line)
    assert all(field in curve_line for field in ("x_min", "x_max", "y_min", "y_max"))
