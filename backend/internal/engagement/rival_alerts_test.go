package engagement_test

import (
	"testing"

	"github.com/google/uuid"

	"github.com/city-competition-remastered/backend/internal/engagement"
)

func TestLeadThreatenedCrossing_CrossesThreshold_ReturnsLeader(t *testing.T) {
	leader := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	second := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	// Pre: 100 vs 80 → gap 0.20 > 0.10
	// Post: 100 vs 92 → gap 0.08 <= 0.10
	pre := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 80},
	}
	post := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 92},
	}

	got, crossed := engagement.LeadThreatenedCrossing(pre, post, 0.10)
	if !crossed {
		t.Fatal("expected crossing")
	}
	if got != leader {
		t.Fatalf("leader=%s want %s", got, leader)
	}
}

func TestLeadThreatenedCrossing_AlreadyWithin_DoesNotCross(t *testing.T) {
	leader := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	second := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	pre := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 95},
	}
	post := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 96},
	}

	_, crossed := engagement.LeadThreatenedCrossing(pre, post, 0.10)
	if crossed {
		t.Fatal("already within threshold should not count as crossing")
	}
}

func TestLeadThreatenedCrossing_DoesNotThreaten_EnqueuesNothing(t *testing.T) {
	leader := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	second := uuid.MustParse("22222222-2222-2222-2222-222222222222")

	// Stay well behind: 100 vs 50 → 100 vs 55, gap still 0.45
	pre := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 50},
	}
	post := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 55},
	}

	_, crossed := engagement.LeadThreatenedCrossing(pre, post, 0.10)
	if crossed {
		t.Fatal("support that does not threaten the lead should not cross")
	}
}

func TestLeadThreatenedCrossing_SingleTribe_NoAlert(t *testing.T) {
	leader := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	pre := []engagement.TribeScore{{TribeID: leader, Sum: 10}}
	post := []engagement.TribeScore{{TribeID: leader, Sum: 20}}
	_, crossed := engagement.LeadThreatenedCrossing(pre, post, 0.10)
	if crossed {
		t.Fatal("single tribe must not alert")
	}
}

func TestLeadThreatenedCrossing_LeadFlip_NoAlert(t *testing.T) {
	a := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	b := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	pre := []engagement.TribeScore{
		{TribeID: a, Sum: 100},
		{TribeID: b, Sum: 95},
	}
	post := []engagement.TribeScore{
		{TribeID: a, Sum: 100},
		{TribeID: b, Sum: 110},
	}
	_, crossed := engagement.LeadThreatenedCrossing(pre, post, 0.10)
	if crossed {
		t.Fatal("lead flip is not a lead-threatened alert")
	}
}

func TestReconstructPreScores_SubtractsDelta(t *testing.T) {
	leader := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	second := uuid.MustParse("22222222-2222-2222-2222-222222222222")
	post := []engagement.TribeScore{
		{TribeID: leader, Sum: 100},
		{TribeID: second, Sum: 92},
	}
	pre := engagement.ReconstructPreScores(post, second, 12)
	if pre[1].Sum != 80 {
		t.Fatalf("second pre sum=%v want 80", pre[1].Sum)
	}
}

func TestGapRatio(t *testing.T) {
	if g := engagement.GapRatio(100, 90); g != 0.10 {
		t.Fatalf("gap=%v want 0.10", g)
	}
}
