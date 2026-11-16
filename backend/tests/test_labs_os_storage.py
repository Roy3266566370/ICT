"""虚拟内存、TLB、文件系统与设备管理的确定性求解。"""
from __future__ import annotations

import pytest

from app.labs.recognize import _attach_solution, build_problem
from app.labs.solvers import solve_problem


def _problem(text: str, *, subject: str | None = None):
    problem = build_problem(text, subject_hint=subject)
    assert problem["subject"] == "operating_system", (text, problem["subject"], problem["model"])
    _attach_solution(problem)
    assert problem["solution"].get("answer"), problem["solution"]
    return problem


def test_clock_replacement_and_working_set():
    problem = _problem(
        "页面访问序列为 1,2,3,2,1,4,1,2,5，物理块数为 3，采用 Clock 置换算法，"
        "工作集窗口为 4，求缺页次数和缺页率。")
    result = problem["model"]["os_result"]
    assert result["algorithm"] == "clock"
    assert result["stats"]["faults"] == 7
    assert result["stats"]["max_working_set"] == 4
    assert result["stats"]["thrash"] is True
    assert any(frame["values"].get("refs") for frame in result["trace"] if frame["action"] == "replace")
    assert [check for check in result["checks"] if check["id"] == "working_set"][0]["status"] == "warn"


def test_request_paging_concept_without_reference():
    problem = _problem("说明请求分页的缺页处理过程，并解释工作集与抖动。")
    answer = problem["solution"]["answer"]
    assert "缺页" in answer and "页表" in answer
    assert "工作集" in answer and "抖动" in answer
    assert problem["model"]["os_result"]["stats"]["concept"] is True


def test_tlb_effective_access_time_and_fault_overhead():
    plain = _problem(
        "某系统 TLB 命中率为 90%，TLB 访问时间为 10ns，内存访问时间为 100ns，"
        "采用一级页表，求有效访问时间。")
    assert plain["model"]["os_kind"] == "tlb"
    assert plain["solution"]["answer_value"] == pytest.approx(120.0)
    assert "EAT" in plain["solution"]["answer"]
    fault = _problem(
        "某系统 TLB 命中率为 90%，TLB 访问时间为 10ns，内存访问时间为 100ns，"
        "缺页率为 1%，缺页处理时间为 1ms，采用一级页表，求有效访问时间。")
    assert fault["solution"]["answer_value"] == pytest.approx(10118.8)
    assert "缺页率" in fault["solution"]["answer"]


def test_tlb_address_translation_uses_declared_mappings():
    problem = _problem(
        "TLB 表：0→5，1→2；页表：2→8，3→9。页大小为 1KB，"
        "虚拟地址为 0x0200、0x0A00，求物理地址和页表访问次数。",
        subject="operating_system")
    result = problem["model"]["os_result"]
    answer = problem["solution"]["answer"]
    assert "0x1600" in answer and "0x2200" in answer
    assert result["stats"]["sample_hits"] == 1
    assert result["stats"]["sample_misses"] == 1
    assert result["stats"]["page_table_accesses"] == 1


def test_tlb_missing_fault_time_blocks_instead_of_guessing():
    problem = build_problem(
        "TLB 命中率为 90%，内存访问时间为 100ns，缺页率为 1%，求有效访问时间。")
    assert problem["subject"] == "operating_system"
    _attach_solution(problem)
    assert problem["status"] != "ready"
    assert any(item["severity"] == "blocking" for item in problem["recognition"]["ambiguities"])


def test_file_permissions_symbolic_and_octal():
    symbolic = _problem("文件权限为 -rwxr-xr--，问文件主、同组用户和其他用户分别有什么权限？")
    answer = symbolic["solution"]["answer"]
    assert "文件主 rwx" in answer and "同组 r-x" in answer and "其他 r--" in answer
    octal = _problem("文件权限为 754，说明各部分权限。")
    assert "rwxr-xr--" in octal["solution"]["answer"]


def test_directory_path_lookup_counts():
    problem = _problem(
        "在树形目录中查找绝对路径 /usr/local/bin/a.txt，若无目录项缓存，"
        "需要读取几次目录、几次 inode？")
    answer = problem["solution"]["answer"]
    assert "目录读取 4 次" in answer and "inode 读取 1 次" in answer


def test_fcb_inode_open_and_links_are_conceptual():
    problem = _problem("说明 FCB 与 inode 的区别，硬链接和软链接有什么区别，打开文件后 read 还需要查目录吗？")
    answer = problem["solution"]["answer"]
    assert "FCB" in answer and "inode" in answer
    assert "硬链接" in answer and "符号链接" in answer
    assert "read/write 不再查目录" in answer
    open_close = _problem("说明文件打开、读写、关闭的过程。")
    assert "open" in open_close["solution"]["answer"] and "close" in open_close["solution"]["answer"]
    concepts = _problem("说明文件权限、共享与链接。")
    assert "rwx" in concepts["solution"]["answer"] and "共享" in concepts["solution"]["answer"]


def test_indexed_allocation_max_file_and_disk_accesses():
    problem = _problem(
        "某文件系统 inode 有 10 个直接地址项、1 个一级间接、1 个二级间接，"
        "盘块大小为 4KB，每个指针占 4B，求最大文件长度。")
    result = problem["model"]["os_result"]
    assert result["stats"]["index"]["max_blocks"] == 10 + 1024 + 1024 ** 2
    assert "4.00394 GB" in problem["solution"]["answer"]
    access = _problem(
        "某文件系统盘块大小为 4KB，每个指针占 4B，inode 有 10 个直接块和 1 个一级间接块，"
        "文件大小为 50KB，求需要多少块，访问最后一个逻辑块需要几次访盘。")
    assert "需要 13 块" in access["solution"]["answer"]
    assert "2 次访盘" in access["solution"]["answer"]


def test_fat_chain_bitmap_and_contiguous_allocation():
    fat = _problem("FAT 表：5→9，9→2，2→EOF，文件从块 5 开始，求文件块链和读取整个文件的访盘次数。")
    assert fat["model"]["os_result"]["stats"]["fat"]["chain"] == [5, 9, 2]
    assert "5 → 9 → 2" in fat["solution"]["answer"]
    bitmap = _problem("位示图为 1 1 0 0 1 0 0，求空闲块数和第一个空闲块号。")
    result = bitmap["model"]["os_result"]
    assert result["stats"]["bitmap"]["free"] == [2, 3, 5, 6]
    assert "空闲块 4 个" in bitmap["solution"]["answer"] and "首个空闲块号 2" in bitmap["solution"]["answer"]
    contiguous = _problem(
        "采用连续分配，文件从块 20 开始，文件大小为 10KB，盘块大小为 4KB，"
        "求占用块范围和内部碎片。")
    answer = contiguous["solution"]["answer"]
    assert "20–22" in answer and "2 KB" in answer


def test_disk_access_time_and_buffer_cycles():
    disk = _problem(
        "某磁盘平均寻道时间为 5ms，转速为 6000rpm，每磁道 100 个扇区，"
        "每个扇区 512B，读取 10 个扇区，求平均访问时间。")
    assert disk["model"]["os_kind"] == "device_mgmt"
    assert disk["solution"]["answer_value"] == pytest.approx(11.0)
    buffer = _problem(
        "单缓冲区中，设备输入一块数据的时间 T=100ms，缓冲区传送到用户区时间 M=50ms，"
        "CPU 处理时间 C=80ms，求单缓冲和双缓冲每块处理时间。")
    answer = buffer["solution"]["answer"]
    assert "单缓冲每块 150 ms" in answer and "双缓冲每块 130 ms" in answer


def test_device_access_time_and_buffering_concepts():
    disk = _problem("磁盘访问时间由哪些部分组成？")
    answer = disk["solution"]["answer"]
    assert "寻道" in answer and "旋转" in answer and "传输" in answer
    buffering = _problem("说明缓冲技术的作用。")
    assert "缓和" in buffering["solution"]["answer"]


def test_new_generic_results_embed_and_replay():
    problem = _problem("位示图为 1 1 0 0 1 0 0，求空闲块数和第一个空闲块号。")
    result = problem["model"]["os_result"]
    assert result["engine"] == "os_file_alloc_v1"
    assert solve_problem(problem["model"])["answer"] == problem["solution"]["answer"]
